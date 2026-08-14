import { Request, Response } from 'express';
import { prisma } from '../../db';
import { analyzePostCreative } from '../../lib/analyzePostCreative';

const BATCH_LIMIT = 40; // rows fetched per DB query round
const TIME_BUDGET_MS = 150_000; // stay under the frontend's 180s call timeout

// Hex-encode a string so it arrives at PostgreSQL as pure ASCII.
// Bypasses Prisma's Linux query-engine bug that re-introduces 0x00 bytes
// when encoding certain Unicode characters for the PostgreSQL wire protocol.
function pgHex(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex');
}

/**
 * backfillCompetitorPostAnalysis — analyzes competitor posts/ads that are
 * already in the DB (scraped before the creative-analysis feature existed,
 * or whose analysis call failed at scrape time) without re-scraping anything.
 *
 * Body: { businessProfileId, force? }
 * force: true re-analyzes rows that already have analyzed_at set too (e.g. after
 * a prompt/schema change) instead of only ones that were never analyzed.
 */
export async function backfillCompetitorPostAnalysis(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const started = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);

  try {
    let postsFound = 0, postsAnalyzed = 0;
    // Loop batches until nothing's left or we're out of time budget — each
    // successfully-analyzed row drops out of the next query (analyzed_at gets set),
    // so this naturally works through the full backlog in one call instead of
    // capping at BATCH_LIMIT like a single query would.
    while (timeLeft() > 0) {
      const posts = await (prisma as any).$queryRawUnsafe(
        `SELECT p.id, p.caption, p.media_url, p.platform FROM competitor_posts p
         JOIN competitors c ON c.id = p.competitor_id
         WHERE p.linked_business = $1 AND p.media_url IS NOT NULL
           ${force ? '' : 'AND p.analyzed_at IS NULL'}
           AND c.tracking_status = 'approved'
         LIMIT ${BATCH_LIMIT}`,
        businessProfileId,
      ) as { id: string; caption: string | null; media_url: string; platform: string }[];
      if (posts.length === 0) break;
      postsFound += posts.length;

      for (const post of posts) {
        if (timeLeft() <= 0) break;
        const analysis = await analyzePostCreative({ caption: post.caption, platform: post.platform, mediaUrl: post.media_url });
        if (!analysis) continue;
        try {
          await (prisma as any).$executeRawUnsafe(
            `UPDATE competitor_posts SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW(), has_offer = $2, has_cta = $3 WHERE id = $4`,
            pgHex(JSON.stringify(analysis)), analysis.has_offer, analysis.has_cta, post.id,
          );
          postsAnalyzed++;
        } catch (err: any) {
          console.error('[backfillCompetitorPostAnalysis] post UPDATE failed:', post.id, err.message);
        }
      }
      // force mode never shrinks the unanalyzed pool (rows stay eligible), so it'd loop forever
      if (force) break;
    }

    let adsFound = 0, adsAnalyzed = 0;
    while (timeLeft() > 0) {
      const ads = await (prisma as any).$queryRawUnsafe(
        `SELECT a.id, a.title, a.body, a.cta, a.media_url, a.platform FROM "competitor_ad_history" a
         JOIN competitors c ON c.id = a.competitor_id
         WHERE a.linked_business = $1 AND a.media_url IS NOT NULL
           ${force ? '' : 'AND a.analyzed_at IS NULL'}
           AND c.tracking_status = 'approved'
         LIMIT ${BATCH_LIMIT}`,
        businessProfileId,
      ) as { id: string; title: string | null; body: string | null; cta: string | null; media_url: string; platform: string }[];
      if (ads.length === 0) break;
      adsFound += ads.length;

      for (const ad of ads) {
        if (timeLeft() <= 0) break;
        const caption = [ad.title, ad.body].filter(Boolean).join(' — ');
        const analysis = await analyzePostCreative({ caption, cta: ad.cta, platform: ad.platform, mediaUrl: ad.media_url });
        if (!analysis) continue;
        try {
          await (prisma as any).$executeRawUnsafe(
            `UPDATE "competitor_ad_history" SET analysis=$1, analyzed_at=NOW(), has_offer=$2, has_cta=$3 WHERE id=$4`,
            JSON.stringify(analysis), analysis.has_offer, analysis.has_cta, ad.id,
          );
          adsAnalyzed++;
        } catch (err: any) {
          console.error('[backfillCompetitorPostAnalysis] ad UPDATE failed:', ad.id, err.message);
        }
      }
      if (force) break;
    }

    // How many are still left for next click (0 unless we ran out of time budget)
    const remaining = await (prisma as any).$queryRawUnsafe(
      `SELECT
         (SELECT COUNT(*) FROM competitor_posts p JOIN competitors c ON c.id = p.competitor_id
           WHERE p.linked_business = $1 AND p.media_url IS NOT NULL AND p.analyzed_at IS NULL AND c.tracking_status = 'approved') AS posts,
         (SELECT COUNT(*) FROM "competitor_ad_history" a JOIN competitors c ON c.id = a.competitor_id
           WHERE a.linked_business = $1 AND a.media_url IS NOT NULL AND a.analyzed_at IS NULL AND c.tracking_status = 'approved') AS ads`,
      businessProfileId,
    ) as { posts: bigint; ads: bigint }[];

    return res.json({
      posts_found: postsFound, posts_analyzed: postsAnalyzed,
      ads_found: adsFound, ads_analyzed: adsAnalyzed,
      posts_remaining: Number(remaining[0]?.posts ?? 0),
      ads_remaining: Number(remaining[0]?.ads ?? 0),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
