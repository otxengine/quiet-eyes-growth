import { prisma } from '../db';

export interface EntityKpis {
  followers: number | null;
  followers_gained_30d: number | null;
  post_count_30d: number;
  avg_interactions_30d: number | null;
  engagement_rate_30d: number | null;
}

const WINDOW_DAYS = 30;
// A daily cron won't land on exactly day-30, so accept a snapshot up to this
// many days older than the exact mark as "the ~30-day-ago baseline".
const BASELINE_TOLERANCE_DAYS = 7;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Followers (current + gained over WINDOW_DAYS) and engagement rate (over the
 * same window) for one entity — the business itself (competitor_id: null) or
 * one tracked competitor. Every field is independently null when its own
 * precondition isn't met (no profiles scraped yet, no snapshot old enough,
 * no posts in the window) — omit rather than fabricate, matching the same
 * convention used by computeReviewTrend/computeThemeRollup.
 */
export async function computeEntityKpis({
  linked_business,
  competitor_id,
}: {
  linked_business: string;
  competitor_id: string | null;
}): Promise<EntityKpis> {
  const now = new Date();
  const sinceEngagement = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const baselineUpper = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const baselineLower = new Date(now.getTime() - (WINDOW_DAYS + BASELINE_TOLERANCE_DAYS) * 24 * 60 * 60 * 1000);

  // Current followers per platform.
  const profiles = competitor_id
    ? await prisma.competitorSocialProfile.findMany({ where: { competitor_id }, select: { platform: true, follower_count: true } })
    : await prisma.businessSocialProfile.findMany({ where: { linked_business }, select: { platform: true, follower_count: true } });

  const currentByPlatform: Record<string, number> = {};
  for (const p of profiles) {
    if (p.follower_count != null) currentByPlatform[p.platform] = p.follower_count;
  }
  const followerVals = Object.values(currentByPlatform);
  const followers = followerVals.length ? followerVals.reduce((a, b) => a + b, 0) : null;

  // Followers ~WINDOW_DAYS ago — most recent snapshot per platform within the tolerance window.
  const baselineRows = (await (prisma as any).$queryRawUnsafe(
    `SELECT platform_key, metric_value FROM (
       SELECT
         split_part(metric_name, ':', 2) AS platform_key,
         metric_value,
         ROW_NUMBER() OVER (PARTITION BY split_part(metric_name, ':', 2) ORDER BY snapshot_date DESC) AS rn
       FROM metrics_snapshots
       WHERE linked_business = $1
         AND competitor_id IS NOT DISTINCT FROM $2
         AND metric_name LIKE 'followers:%'
         AND snapshot_date <= $3
         AND snapshot_date >= $4
     ) ranked WHERE rn = 1`,
    linked_business, competitor_id, ymd(baselineUpper), ymd(baselineLower),
  )) as { platform_key: string; metric_value: number }[];

  // Only compare platforms present in BOTH current and baseline — a newly
  // added platform since the baseline shouldn't look like organic growth.
  let gainedSum = 0;
  let matchedPlatforms = 0;
  for (const row of baselineRows) {
    const current = currentByPlatform[row.platform_key];
    if (current != null && row.metric_value != null) {
      gainedSum += current - row.metric_value;
      matchedPlatforms++;
    }
  }
  const followers_gained_30d = matchedPlatforms > 0 ? gainedSum : null;

  // Engagement over the window — same avg_interactions formula as
  // GET /api/competitors/social/leaderboard, just parameterized per entity.
  const table = competitor_id ? 'competitor_posts' : 'business_posts';
  const idCol = competitor_id ? 'competitor_id' : 'linked_business';
  const idVal = competitor_id ?? linked_business;

  const engagementRows = (await (prisma as any).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS post_count,
            COALESCE(SUM(likes), 0)::int AS total_likes,
            COALESCE(SUM(comments_count), 0)::int AS total_comments
     FROM ${table}
     WHERE ${idCol} = $1 AND posted_at::timestamptz >= $2::timestamptz`,
    idVal, sinceEngagement.toISOString(),
  )) as { post_count: number; total_likes: number; total_comments: number }[];

  const post_count_30d = engagementRows[0]?.post_count ?? 0;
  const avg_interactions_30d = post_count_30d > 0
    ? Math.round((engagementRows[0].total_likes + engagementRows[0].total_comments) / post_count_30d)
    : null;
  const engagement_rate_30d = followers && avg_interactions_30d != null
    ? (avg_interactions_30d / followers) * 100
    : null;

  return { followers, followers_gained_30d, post_count_30d, avg_interactions_30d, engagement_rate_30d };
}
