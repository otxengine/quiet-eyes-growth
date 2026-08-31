import { prisma } from '../../db';
import { GOOGLE_REVIEW_SOURCES } from '../../lib/signalGuard';

export interface ThemeCount {
  theme: string;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

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
 */
export async function computeReviewTrend(
  filter: { linked_business: string } | { linked_competitor: string },
): Promise<ReviewTrend | null> {
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);

  const reviews = await prisma.review.findMany({
    where: { ...filter, source_origin: { in: GOOGLE_REVIEW_SOURCES }, rating: { not: null } },
    select: { rating: true, created_at: true, created_date: true },
    take: 200,
  });

  const reviewDate = (r: { created_at: string | null; created_date: Date }) => new Date(r.created_at || r.created_date);
  const recent = reviews.filter(r => reviewDate(r) >= d30);
  const prior  = reviews.filter(r => reviewDate(r) >= d60 && reviewDate(r) < d30);

  // ponytail: omit rather than fabricate — too little data in either window to call a trend.
  if (recent.length < 3 || prior.length < 3) return null;

  const avg = (arr: typeof reviews) => arr.reduce((s, r) => s + (r.rating ?? 0), 0) / arr.length;
  const delta = avg(recent) - avg(prior);
  if (delta > 0.1) return 'improving';
  if (delta < -0.1) return 'declining';
  return 'stable';
}
