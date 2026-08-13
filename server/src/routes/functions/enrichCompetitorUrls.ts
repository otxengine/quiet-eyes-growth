import { Request, Response } from 'express';
import { prisma } from '../../db';
import { extractSocialLinksFromWebsite } from '../../lib/extractSocialLinksFromWebsite';
import { writeAutomationLog } from '../../lib/automationLog';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CATCH_UP_CAP = 10; // same cap as discoverCompetitorUrls' own scheduler job

/**
 * enrichCompetitorUrls — KAN-219: site-extract as the primary social path for rivals
 * that already have a `website_url` (consumed from Doc 16 / KAN-213's early identify
 * write), via KAN-218's extractSocialLinksFromWebsite. Fill-if-empty only (AC5 — never
 * overwrites a manual or previously-set value). Called inline from
 * runCompetitorIdentification for the batch of touched ids (AC0), not on a deferred
 * scheduler tick — independent of the snapshot 6h/7d skip (AC2).
 */
export async function enrichCompetitorUrls(
  competitorIds: string[],
  opts: { force?: boolean } = {}
): Promise<{ enriched: number; skipped: number }> {
  if (!competitorIds.length) return { enriched: 0, skipped: 0 };

  const competitors = await prisma.competitor.findMany({ where: { id: { in: competitorIds } } });

  let enriched = 0;
  let skipped = 0;

  for (const c of competitors) {
    const comp = c as any;

    // AC7 — nothing to consume without a website_url
    if (!comp.website_url) { skipped++; continue; }

    const anySocialEmpty = !comp.instagram_url || !comp.facebook_url || !comp.tiktok_url;
    if (!anySocialEmpty && !opts.force) { skipped++; continue; }

    const links = await extractSocialLinksFromWebsite(comp.website_url);

    // Fill-if-empty (AC5) — stamp TTL on success or soft-empty either way (AC0/TTL criterion)
    const update: Record<string, any> = { social_pages_crawled_at: new Date().toISOString() };
    if (links.instagram_url && !comp.instagram_url) update.instagram_url = links.instagram_url;
    if (links.facebook_url  && !comp.facebook_url)  update.facebook_url  = links.facebook_url;
    if (links.tiktok_url    && !comp.tiktok_url)    update.tiktok_url    = links.tiktok_url;

    await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
    enriched++;
  }

  return { enriched, skipped };
}

/**
 * enrichCompetitorUrlsScheduled — KAN-221: dedicated scheduler catch-up.
 * Own TTL (~7d) + cap, independent of batchSnapshotCompetitors' 6h last_scanned skip.
 * Catches up rivals with a website_url but any social field empty OR crawled >7d ago;
 * `force` bypasses that filter and re-runs the capped batch regardless of freshness.
 */
export async function enrichCompetitorUrlsScheduled(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const staleCutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const candidates = await prisma.competitor.findMany({
      where: {
        linked_business: businessProfileId,
        website_url: { not: null },
        ...(force ? {} : {
          OR: [
            { instagram_url: null },
            { facebook_url: null },
            { tiktok_url: null },
            { social_pages_crawled_at: null },
            { social_pages_crawled_at: { lt: staleCutoff } },
          ],
        }),
      },
      orderBy: { social_pages_crawled_at: 'asc' },
      take: CATCH_UP_CAP,
      select: { id: true },
    });

    const result = await enrichCompetitorUrls(candidates.map((c: any) => c.id), { force });
    await writeAutomationLog('enrichCompetitorUrlsScheduled', businessProfileId, startTime, result.enriched);
    return res.json(result);
  } catch (err: any) {
    console.error('[enrichCompetitorUrlsScheduled] error:', err.message);
    await writeAutomationLog('enrichCompetitorUrlsScheduled', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
