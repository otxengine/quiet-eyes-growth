import { prisma } from '../../db';
import { extractSocialLinksFromWebsite } from '../../lib/extractSocialLinksFromWebsite';

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
