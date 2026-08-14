import { Request, Response } from 'express';
import { prisma } from '../../db';
import { analyzePostCreative } from '../../lib/analyzePostCreative';

const BATCH_LIMIT = 40; // cap per run — vision calls are slow/costly

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
 * Body: { businessProfileId }
 */
export async function backfillCompetitorPostAnalysis(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const posts = await (prisma as any).$queryRawUnsafe(
      `SELECT id, caption, media_url, platform FROM competitor_posts
       WHERE linked_business = $1 AND analyzed_at IS NULL AND media_url IS NOT NULL
       LIMIT ${BATCH_LIMIT}`,
      businessProfileId,
    ) as { id: string; caption: string | null; media_url: string; platform: string }[];

    let postsAnalyzed = 0;
    for (const post of posts) {
      const analysis = await analyzePostCreative({ caption: post.caption, platform: post.platform, mediaUrl: post.media_url });
      if (!analysis) continue;
      try {
        await (prisma as any).$executeRawUnsafe(
          `UPDATE competitor_posts SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW() WHERE id = $2`,
          pgHex(JSON.stringify(analysis)), post.id,
        );
        postsAnalyzed++;
      } catch (err: any) {
        console.error('[backfillCompetitorPostAnalysis] post UPDATE failed:', post.id, err.message);
      }
    }

    const ads = await (prisma as any).$queryRawUnsafe(
      `SELECT id, title, body, cta, media_url, platform FROM "competitor_ad_history"
       WHERE linked_business = $1 AND analyzed_at IS NULL AND media_url IS NOT NULL
       LIMIT ${BATCH_LIMIT}`,
      businessProfileId,
    ) as { id: string; title: string | null; body: string | null; cta: string | null; media_url: string; platform: string }[];

    let adsAnalyzed = 0;
    for (const ad of ads) {
      const caption = [ad.title, ad.body].filter(Boolean).join(' — ');
      const analysis = await analyzePostCreative({ caption, cta: ad.cta, platform: ad.platform, mediaUrl: ad.media_url });
      if (!analysis) continue;
      try {
        await (prisma as any).$executeRawUnsafe(
          `UPDATE "competitor_ad_history" SET analysis=$1, analyzed_at=NOW() WHERE id=$2`,
          JSON.stringify(analysis), ad.id,
        );
        adsAnalyzed++;
      } catch (err: any) {
        console.error('[backfillCompetitorPostAnalysis] ad UPDATE failed:', ad.id, err.message);
      }
    }

    return res.json({
      posts_found: posts.length, posts_analyzed: postsAnalyzed,
      ads_found: ads.length, ads_analyzed: adsAnalyzed,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
