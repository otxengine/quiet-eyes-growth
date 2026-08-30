import { Request, Response } from 'express';
import { prisma } from '../../db';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SITE_BLACKLIST = ['instagram.com', 'facebook.com', 'google.com', 'yad2'];

// Non-profile path segments for each platform — filter these out so we only keep main pages.
export const IG_NON_PROFILE  = ['p/', 'reel/', 'stories/', 'explore/', 'tv/', 'reels/'];
export const FB_NON_PROFILE  = ['posts/', 'photos/', 'videos/', 'events/', 'photo/', 'video/'];

export function isProfileUrl(url: string, domain: string, nonProfile: string[]): boolean {
  if (!url?.includes(domain)) return false;
  const path = (url.split(domain)[1] ?? '').replace(/^\/+/, '').split('?')[0];
  return path.length > 0 && !nonProfile.some(seg => path.includes(seg));
}

// Strips query string/fragment so a raw search-result URL (which may carry
// tracking params etc.) never gets stored as-is — downstream social-media
// scraping tools reject a profile URL with anything after the username
// that isn't a literal "/", so "?hl=en" breaks it even though it's a
// cosmetically valid profile link.
function cleanUrl(url: string): string {
  return url.split('?')[0].split('#')[0];
}

// Returns the handle/username portion of a social URL (strips @ and trailing path).
function extractHandle(url: string): string {
  const stripped = url.replace(/^https?:\/\/(www\.)?/, '');
  return ((stripped.split('/')[1] ?? '').replace(/^@/, '').split('?')[0]).toLowerCase();
}

// Returns true if the handle plausibly belongs to the business (not a third-party reviewer).
// Falls back to true when there is no Latin reference to compare against.
export function handleMatchesBusiness(url: string, name: string, nameEn: string | null): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = norm(extractHandle(url));
  if (!h) return false;
  const latinWords = (name.match(/[a-zA-Z]{3,}/g) ?? []).map(norm);
  if (!nameEn && !latinWords.length) return true; // ponytail: no Latin ref → can't reject
  if (nameEn) {
    for (const word of nameEn.split(/\s+/).filter(w => w.length >= 3)) {
      if (h.includes(norm(word))) return true;
    }
  }
  return latinWords.some(w => h.includes(w));
}

// Vote across N result sets: best URL = most common candidate; high = appears in 2+ sets.
function pickBest(
  sets: any[][], includes: string,
  keep?: (url: string) => boolean,
): { url: string | null; high: boolean } {
  const counts = new Map<string, number>();
  for (const set of sets)
    for (const r of set)
      if (r.url?.includes(includes) && (!keep || keep(r.url)))
        counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
  if (!counts.size) return { url: null, high: false };
  const [url, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { url, high: n >= 2 };
}

function pickSite(sets: any[][]): { url: string | null; high: boolean } {
  const ok = (u: string) => !!u && !SITE_BLACKLIST.some(b => u.includes(b));
  return pickBest(sets.map(s => s.filter(r => ok(r.url ?? ''))), '/', ok);
}

// Returns the English/Latin transliteration of a Hebrew name, or null if already Latin or LLM fails.
async function toEnglishName(name: string): Promise<string | null> {
  if (!/[֐-׿]/.test(name)) return null; // already Latin — no extra query needed
  try {
    const result: any = await invokeLLM({
      model: 'haiku',
      maxTokens: 30,
      prompt: `Transliterate this Hebrew business name to English (Latin letters, common romanization). Return ONLY the English name: "${name}"`,
      response_json_schema: { type: 'object', properties: { en: { type: 'string' } }, required: ['en'] },
    });
    const en = result?.en?.trim();
    return en && en !== name ? en : null;
  } catch {
    return null;
  }
}

/**
 * discoverCompetitorUrls — dedicated Tavily URL discovery job (KAN-160).
 *
 * Independent of batchSnapshotCompetitors; staleness guard on social_pages_crawled_at.
 * Fires 4 query variants per platform (HE+city / HE / EN+city / EN) when an English
 * transliteration is available, otherwise 2. High confidence = same URL in 2+ variants.
 *
 * KAN-222: a field the owner manually set (comp.manual_url_fields) is never overwritten,
 * even at high confidence, unless req.body.force is true.
 */
export async function discoverCompetitorUrls(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let discovered = 0;

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { category, city } = profile;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      // Postgres sorts NULL last in ASC order by default — without `nulls: 'first'`,
      // never-crawled competitors get starved out of the top-10 by already-crawled ones.
      orderBy: { social_pages_crawled_at: { sort: 'asc', nulls: 'first' } },
      take: 10,
    });

    for (const comp of competitors) {
      if (isTavilyRateLimited()) break;

      const lastCrawlMs = (comp as any).social_pages_crawled_at
        ? new Date((comp as any).social_pages_crawled_at).getTime() : 0;
      if (Date.now() - lastCrawlMs < SEVEN_DAYS_MS) continue;

      try {
        const nameEn = await toEnglishName(comp.name);

        // Build ±city × ±EN query prefixes: ["HE+city", "HE", "EN+city"?, "EN"?]
        const prefixes = [
          `"${comp.name}" ${city}`,
          `"${comp.name}"`,
          ...(nameEn ? [`"${nameEn}" ${city}`, `"${nameEn}"`] : []),
        ];

        // Fire all variants in parallel, grouped by platform
        const [igSets, fbSets, siteSets] = await Promise.all([
          Promise.all(prefixes.map(p => tavilySearch(`${p} site:instagram.com`, 3))),
          Promise.all(prefixes.map(p => tavilySearch(`${p} site:facebook.com`, 3))),
          Promise.all([
            tavilySearch(`"${comp.name}" ${city} ${category} אתר רשמי`, 2),
            tavilySearch(`"${comp.name}" ${category} אתר רשמי`, 2),
            ...(nameEn ? [
              tavilySearch(`"${nameEn}" ${city} ${category} official website`, 2),
              tavilySearch(`"${nameEn}" ${category} official website`, 2),
            ] : []),
          ]),
        ]);

        const ig   = pickBest(igSets,  'instagram.com/', u => isProfileUrl(u, 'instagram.com/', IG_NON_PROFILE)  && handleMatchesBusiness(u, comp.name, nameEn));
        const fb   = pickBest(fbSets,  'facebook.com/',  u => isProfileUrl(u, 'facebook.com/',  FB_NON_PROFILE)  && handleMatchesBusiness(u, comp.name, nameEn));
        const site = pickSite(siteSets);

        const c = comp as any;
        const manualFields: string[] = c.manual_url_fields ?? [];
        const canOverwrite = (field: string) => force || !manualFields.includes(field);
        const update: Record<string, any> = { social_pages_crawled_at: new Date().toISOString() };

        if (ig.url   && ((ig.high   && canOverwrite('instagram_url')) || !c.instagram_url)) update.instagram_url = cleanUrl(ig.url);
        if (fb.url   && ((fb.high   && canOverwrite('facebook_url'))  || !c.facebook_url))  update.facebook_url  = cleanUrl(fb.url);
        if (site.url && ((site.high && canOverwrite('website_url'))   || !c.website_url))   update.website_url   = site.url;

        await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
        discovered++;
        console.log(
          `[discoverCompetitorUrls] ${comp.name}${nameEn ? ` (${nameEn})` : ''}: ` +
          `ig=${!!ig.url}(${ig.high ? 'hi' : 'lo'}) fb=${!!fb.url}(${fb.high ? 'hi' : 'lo'}) ` +
          `site=${!!site.url}(${site.high ? 'hi' : 'lo'})`
        );
      } catch (e: any) {
        console.warn(`[discoverCompetitorUrls] ${comp.name} failed:`, e.message);
      }
    }

    await writeAutomationLog('discoverCompetitorUrls', businessProfileId, startTime, discovered);
    return res.json({ discovered, competitors_checked: competitors.length });
  } catch (err: any) {
    console.error('[discoverCompetitorUrls] error:', err.message);
    await writeAutomationLog('discoverCompetitorUrls', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
