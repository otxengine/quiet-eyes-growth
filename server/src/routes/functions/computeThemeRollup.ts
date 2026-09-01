import { prisma } from '../../db';
import { GOOGLE_REVIEW_SOURCES } from '../../lib/signalGuard';

export interface ThemeCount {
  theme: string;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

// Shared window for every Reviews-pillar surface on the Insights page (own-business
// narrative, pooled-competitor narrative, own-vs-competitor topic radar) so they all
// describe the same period instead of three independently-hardcoded windows silently
// disagreeing (was 90d/90d/365d — see KAN reviews-insights time-frame unification).
// 365, not 90, because review volume per topic is too sparse over shorter windows for
// many small businesses (c5d136a/56d3882) — widening only adds data, never removes it.
export const REVIEWS_INSIGHTS_WINDOW_DAYS = 365;

/**
 * Aggregates topic_sentiment JSON blobs from reviews into per-topic polarity counts.
 * windowDays defaults to 90.
 * platformFilter='google' restricts to Google-sourced reviews only (AC2: KAN-127).
 * linkedCompetitorId queries competitor reviews instead of own-business reviews.
 *
 * Filters on created_at (the review's actual post date, scraped from Google), not
 * created_date (when the row was inserted into our DB) — see c5d136a. created_at is
 * stored as text in inconsistent formats across scrape sources, hence the
 * ::timestamptz cast via raw SQL rather than Prisma's typed string-only comparison.
 */
export async function computeThemeRollup(
  businessProfileId: string,
  windowDays = 90,
  platformFilter?: 'google',
  linkedCompetitorId?: string,
): Promise<ThemeCount[]> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const params: unknown[] = [linkedCompetitorId ?? businessProfileId, since.toISOString()];
  let sql = `
    SELECT topic_sentiment FROM reviews
    WHERE ${linkedCompetitorId ? 'linked_competitor' : 'linked_business'} = $1
      AND created_at::timestamptz >= $2::timestamptz
      AND topic_sentiment IS NOT NULL
  `;
  if (platformFilter === 'google') {
    params.push(GOOGLE_REVIEW_SOURCES);
    sql += ` AND source_origin = ANY($3::text[])`;
  }

  const reviews = (await (prisma as any).$queryRawUnsafe(sql, ...params)) as { topic_sentiment: string }[];

  const counts: Record<string, { positive: number; negative: number; neutral: number }> = {};

  for (const r of reviews) {
    if (!r.topic_sentiment) continue;
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(r.topic_sentiment);
    } catch {
      continue;
    }
    for (const [topic, polarity] of Object.entries(parsed)) {
      if (!counts[topic]) counts[topic] = { positive: 0, negative: 0, neutral: 0 };
      const key = polarity === 'positive' ? 'positive' : polarity === 'negative' ? 'negative' : 'neutral';
      counts[topic][key]++;
    }
  }

  return Object.entries(counts)
    .map(([theme, c]) => ({ theme, ...c, total: c.positive + c.negative + c.neutral }))
    .sort((a, b) => b.total - a.total);
}

export type ReviewTrend = 'improving' | 'declining' | 'stable';

/**
 * Compares avg rating of the last 30 days vs. the prior 30-60 day window to
 * detect directional movement. Originally private to getCompetitorReviewInsights.ts
 * (competitor-only); generalized here so own-business reviews can use it too.
 *
 * Aggregates both windows directly in SQL (FILTER + ::timestamptz cast, same pattern
 * as computeThemeRollup above) rather than fetching `take: N` rows and filtering in
 * JS — on a business with hundreds of reviews spanning years, an unordered `take`
 * grabs an arbitrary subset that can miss the actual recent rows entirely, silently
 * returning null even when real recent activity exists.
 */
export async function computeReviewTrend(
  filter: { linked_business: string } | { linked_competitor: string },
): Promise<ReviewTrend | null> {
  const column = 'linked_business' in filter ? 'linked_business' : 'linked_competitor';
  const value = 'linked_business' in filter ? filter.linked_business : filter.linked_competitor;

  const rows = (await (prisma as any).$queryRawUnsafe(
    `SELECT
       COUNT(*) FILTER (WHERE created_at::timestamptz >= now() - interval '30 days')::int AS recent_count,
       AVG(rating) FILTER (WHERE created_at::timestamptz >= now() - interval '30 days')::float AS recent_avg,
       COUNT(*) FILTER (WHERE created_at::timestamptz >= now() - interval '60 days' AND created_at::timestamptz < now() - interval '30 days')::int AS prior_count,
       AVG(rating) FILTER (WHERE created_at::timestamptz >= now() - interval '60 days' AND created_at::timestamptz < now() - interval '30 days')::float AS prior_avg
     FROM reviews
     WHERE ${column} = $1 AND source_origin = ANY($2::text[]) AND rating IS NOT NULL`,
    value, GOOGLE_REVIEW_SOURCES,
  )) as { recent_count: number; recent_avg: number | null; prior_count: number; prior_avg: number | null }[];

  const { recent_count, recent_avg, prior_count, prior_avg } = rows[0];

  // ponytail: omit rather than fabricate — too little data in either window to call a trend.
  if (recent_count < 3 || prior_count < 3) return null;

  const delta = (recent_avg as number) - (prior_avg as number);
  if (delta > 0.1) return 'improving';
  if (delta < -0.1) return 'declining';
  return 'stable';
}
