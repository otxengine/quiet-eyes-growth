import { prisma } from '../db';
import { analyzePostCreative } from './analyzePostCreative';

// Hex-encode a string so it arrives at PostgreSQL as pure ASCII — see
// backfillCompetitorPostAnalysis.ts for why (Prisma/Postgres Unicode bug).
function pgHex(s: string): string {
  return Buffer.from(s, 'utf8').toString('hex');
}

type OutlierTable = 'competitor_posts' | 'business_posts';

/**
 * Re-analyzes one post with performance context (hook/content_pillar/
 * audience_action_driver grounded in how many times its engagement beat the
 * account's average), for a post already known to be an engagement outlier.
 *
 * Skips posts whose analysis already has a `hook` (i.e. already outlier-analyzed)
 * unless force — this is what keeps repeated/future-automatic calls cheap.
 */
export async function applyOutlierAnalysis(
  table: OutlierTable,
  postId: string,
  engagementMultiple: number,
  force: boolean,
): Promise<{ analyzed: boolean; skipped: boolean }> {
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id, caption, media_url, video_url, platform, analysis FROM "${table}" WHERE id = $1`,
    postId,
  ) as { id: string; caption: string | null; media_url: string | null; video_url: string | null; platform: string; analysis: string | null }[];
  const post = rows[0];
  if (!post || (!post.media_url && !post.video_url)) return { analyzed: false, skipped: false };

  if (!force) {
    try {
      const existing = post.analysis ? JSON.parse(post.analysis) : null;
      if (existing?.hook) return { analyzed: false, skipped: true };
    } catch { /* malformed existing JSON — fall through and re-analyze */ }
  }

  // Unlike the scrape/backfill paths, this is manually click-triggered and
  // already gated above by `hook`, so it's fine to (re-)use the video even if
  // video_analyzed_at is already set — the outlier "hook" explanation is exactly
  // where real video content (motion, spoken script) matters most.
  const analysis = await analyzePostCreative({
    caption: post.caption,
    platform: post.platform,
    mediaUrl: post.media_url,
    videoUrl: post.video_url,
    performanceContext: { engagementMultiple },
  });
  if (!analysis) return { analyzed: false, skipped: false };

  await (prisma as any).$executeRawUnsafe(
    `UPDATE "${table}" SET analysis = convert_from(decode($1, 'hex'), 'UTF8'), analyzed_at = NOW(), has_offer = $2, has_cta = $3
     ${post.video_url && analysis.video_description != null ? ', video_analyzed_at = NOW()' : ''}
     WHERE id = $4`,
    pgHex(JSON.stringify(analysis)), analysis.has_offer, analysis.has_cta, postId,
  );
  return { analyzed: true, skipped: false };
}
