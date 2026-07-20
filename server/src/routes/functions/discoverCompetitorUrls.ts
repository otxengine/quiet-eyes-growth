import { Request, Response } from 'express';
import { prisma } from '../../db';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_BLACKLIST = ['instagram.com', 'facebook.com', 'tiktok.com', 'google.com', 'yad2'];

// Vote across N result sets: best URL = most common candidate; high = appears in 2+ sets.
function pickBest(sets: any[][], includes: string): { url: string | null; high: boolean } {
  const counts = new Map<string, number>();
  for (const set of sets)
    for (const r of set)
      if (r.url?.includes(includes)) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
  if (!counts.size) return { url: null, high: false };
  const [url, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { url, high: n >= 2 };
}

function pickSite(sets: any[][]): { url: string | null; high: boolean } {
  const ok = (u: string) => !!u && !SITE_BLACKLIST.some(b => u.includes(b));
  return pickBest(sets.map(s => s.filter(r => ok(r.url ?? ''))), '/');
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
 */
export async function discoverCompetitorUrls(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let discovered = 0;

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { category, city } = profile;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { social_pages_crawled_at: 'asc' }, // least-recently crawled first
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
        const [igSets, fbSets, tikSets, siteSets] = await Promise.all([
          Promise.all(prefixes.map(p => tavilySearch(`${p} site:instagram.com`, 3))),
          Promise.all(prefixes.map(p => tavilySearch(`${p} site:facebook.com`, 3))),
          Promise.all(prefixes.map(p => tavilySearch(`${p} site:tiktok.com`, 3))),
          Promise.all([
            tavilySearch(`"${comp.name}" ${city} ${category} אתר רשמי`, 2),
            tavilySearch(`"${comp.name}" ${category} אתר רשמי`, 2),
            ...(nameEn ? [
              tavilySearch(`"${nameEn}" ${city} ${category} official website`, 2),
              tavilySearch(`"${nameEn}" ${category} official website`, 2),
            ] : []),
          ]),
        ]);

        const ig   = pickBest(igSets,  'instagram.com/');
        const fb   = pickBest(fbSets,  'facebook.com/');
        const tik  = pickBest(tikSets, 'tiktok.com/');
        const site = pickSite(siteSets);

        const c = comp as any;
        const update: Record<string, any> = { social_pages_crawled_at: new Date().toISOString() };

        if (ig.url   && (ig.high   || !c.instagram_url)) update.instagram_url = ig.url;
        if (fb.url   && (fb.high   || !c.facebook_url))  update.facebook_url  = fb.url;
        if (tik.url  && (tik.high  || !c.tiktok_url))    update.tiktok_url    = tik.url;
        if (site.url && (site.high || !c.website_url))   update.website_url   = site.url;

        await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
        discovered++;
        console.log(
          `[discoverCompetitorUrls] ${comp.name}${nameEn ? ` (${nameEn})` : ''}: ` +
          `ig=${!!ig.url}(${ig.high ? 'hi' : 'lo'}) fb=${!!fb.url}(${fb.high ? 'hi' : 'lo'}) ` +
          `tik=${!!tik.url}(${tik.high ? 'hi' : 'lo'}) site=${!!site.url}(${site.high ? 'hi' : 'lo'})`
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
