import { Request, Response } from 'express';
import { prisma } from '../../db';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_BLACKLIST = ['instagram.com', 'facebook.com', 'tiktok.com', 'google.com', 'yad2'];

// Returns first URL matching `includes`, and whether both ±city searches agree (high confidence).
function pickBest(withCity: any[], withoutCity: any[], includes: string): { url: string | null; high: boolean } {
  const extract = (arr: any[]) => arr.map(r => r.url as string).filter(u => u?.includes(includes));
  const wc = extract(withCity);
  const wo = extract(withoutCity);
  const url = wc[0] ?? wo[0] ?? null;
  return { url, high: !!(url && wc[0] && wo[0] && wc[0] === wo[0]) };
}

function pickSite(withCity: any[], withoutCity: any[]): { url: string | null; high: boolean } {
  const ok = (u: string) => u && !SITE_BLACKLIST.some(b => u.includes(b));
  const extract = (arr: any[]) => arr.map(r => r.url as string).filter(ok);
  const wc = extract(withCity);
  const wo = extract(withoutCity);
  const url = wc[0] ?? wo[0] ?? null;
  return { url, high: !!(url && wc[0] && wo[0] && wc[0] === wo[0]) };
}

/**
 * discoverCompetitorUrls — dedicated Tavily URL discovery job (KAN-160).
 *
 * Runs independently of batchSnapshotCompetitors; uses social_pages_crawled_at
 * as its own staleness guard (not last_scanned). Fires ±city site: queries for
 * every platform. Overwrites existing URLs when both query variants agree
 * (high confidence); otherwise fills empty fields only.
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
        const [igW, igN, fbW, fbN, tikW, tikN, siteW, siteN] = await Promise.all([
          tavilySearch(`"${comp.name}" ${city} site:instagram.com`, 3),
          tavilySearch(`"${comp.name}" site:instagram.com`, 3),
          tavilySearch(`"${comp.name}" ${city} site:facebook.com`, 3),
          tavilySearch(`"${comp.name}" site:facebook.com`, 3),
          tavilySearch(`"${comp.name}" ${city} site:tiktok.com`, 3),
          tavilySearch(`"${comp.name}" site:tiktok.com`, 3),
          tavilySearch(`"${comp.name}" ${city} ${category} אתר רשמי`, 2),
          tavilySearch(`"${comp.name}" ${category} אתר רשמי`, 2),
        ]);

        const ig   = pickBest(igW, igN, 'instagram.com/');
        const fb   = pickBest(fbW, fbN, 'facebook.com/');
        const tik  = pickBest(tikW, tikN, 'tiktok.com/');
        const site = pickSite(siteW, siteN);

        const c = comp as any;
        const update: Record<string, any> = { social_pages_crawled_at: new Date().toISOString() };

        if (ig.url   && (ig.high   || !c.instagram_url)) update.instagram_url = ig.url;
        if (fb.url   && (fb.high   || !c.facebook_url))  update.facebook_url  = fb.url;
        if (tik.url  && (tik.high  || !c.tiktok_url))    update.tiktok_url    = tik.url;
        if (site.url && (site.high || !c.website_url))   update.website_url   = site.url;

        await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
        discovered++;
        console.log(
          `[discoverCompetitorUrls] ${comp.name}: ig=${!!ig.url}(${ig.high ? 'hi' : 'lo'})` +
          ` fb=${!!fb.url}(${fb.high ? 'hi' : 'lo'}) tik=${!!tik.url}(${tik.high ? 'hi' : 'lo'})` +
          ` site=${!!site.url}(${site.high ? 'hi' : 'lo'})`
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
