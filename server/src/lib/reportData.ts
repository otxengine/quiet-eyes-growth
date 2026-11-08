import { prisma } from '../db';
import { tallyThemes } from '../routes/functions/computeThemeRollup';
import type { ReportType } from './reportPeriod';

// Raw SQL throughout: several timestamp columns are TEXT in the DB (posted_at,
// created_at, start_date, detected_at, executed_at) and Prisma's typed filters
// can't range-compare them (see routes/competitors.ts / lib/socialKpis.ts).
const q = <T = any>(sql: string, ...params: unknown[]) =>
  (prisma as any).$queryRawUnsafe(sql, ...params) as Promise<T[]>;

// Mixed-format text timestamp → timestamptz, NULL when it doesn't look like a date,
// so one junk row can't abort the whole report query. Offset-less values (and the
// timestamp(3) columns) are read in the session TZ — UTC on RDS, same as the rest of the code.
// ponytail: month/day ranges are checked, not calendar validity — '2026-02-30' still throws.
const ts = (col: string) =>
  `(CASE WHEN (${col})::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' THEN (${col})::text::timestamptz END)`;
// Every query uses $1 = businessProfileId, $2 = period start, $3 = period end (exclusive).
const inWindow = (col: string) => `${ts(col)} >= $2::timestamptz AND ${ts(col)} < $3::timestamptz`;

const REPLIED = ['published', 'responded', 'auto_responded'];

// market_signals categories the reports read as "competitor changes" (price / promo /
// website moves). The signal cleanup jobs keep these 40 days (cleanupAndLearn /
// updateLeadFreshness) so the monthly report still sees the whole previous month.
// Not 'competitor_ads': detectCompetitorAds writes one per competitor per daily scan,
// which would flood the list — the ads section already covers them from ad history.
export const REPORT_SIGNAL_CATEGORIES = ['competitor_move'];
// Prisma where-fragment: rows NOT in those categories (category IS NULL included —
// a bare notIn would silently exempt null-category rows from purges too).
export const NOT_REPORT_SIGNAL = {
  OR: [{ category: null }, { category: { notIn: REPORT_SIGNAL_CATEGORIES } }],
};

function offerOf(analysis: string | null) {
  if (!analysis) return null;
  try {
    const a = JSON.parse(analysis);
    return { details: a.offer_details ?? null, mechanic: a.offer_mechanic ?? null, urgency: a.offer_urgency ?? null };
  } catch {
    return null;
  }
}

const engagement = (p: { likes: number | null; comments_count: number | null }) => (p.likes ?? 0) + (p.comments_count ?? 0);

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string | null, T[]> {
  const m = new Map<string | null, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

function postsSummary(rows: any[]) {
  const by_platform: Record<string, number> = {};
  for (const p of rows) by_platform[p.platform] = (by_platform[p.platform] ?? 0) + 1;
  return {
    count: rows.length,
    by_platform,
    total_engagement: rows.reduce((s, p) => s + engagement(p), 0),
    top: [...rows].sort((a, b) => engagement(b) - engagement(a)).slice(0, 3).map(p => ({
      platform: p.platform, url: p.post_url, caption: p.caption, posted_at: p.posted_at,
      likes: p.likes, comments: p.comments_count, offer: p.has_offer ? offerOf(p.analysis) : null,
    })),
  };
}

const adItem = (a: any) => ({
  platform: a.platform, title: a.title, body: a.body, cta: a.cta, link: a.link,
  started_at: a.started_at, offer: a.has_offer ? offerOf(a.analysis) : null,
});

// New ads in the window: Meta ads carry a real start_date; Google ads don't, so
// fall back to when we first saw them — but not for rows cloned from another
// business's scan, whose first_seen_at is the clone time, not the launch.
const newAdsWhere = `(
  (${inWindow('start_date')})
  OR (start_date IS NULL AND COALESCE(cloned_from_donor, false) = false
      AND first_seen_at >= $2::timestamptz AND first_seen_at < $3::timestamptz)
)`;

function reviewStats(rows: any[], own: boolean) {
  if (rows.length === 0) return { count: 0 };
  const rated = rows.filter(r => r.rating != null);
  const negatives = rated.filter(r => r.rating <= 2);
  return {
    count: rows.length,
    avg_rating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 100) / 100 : null,
    negative: negatives.length,
    ...(own ? { reply_rate: Math.round((rows.filter(r => REPLIED.includes(r.response_status)).length / rows.length) * 100) } : {}),
    themes: tallyThemes(rows).slice(0, 5),
    negative_samples: negatives.map(r => r.text).filter(Boolean).slice(0, 3),
  };
}

const ymdIL = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);

/**
 * Followers gained over the period per entity (competitor_id, null = own business):
 * last snapshot on/before the period start vs the last one inside the period, summed
 * over platforms that have both. Absent → no entry (omit rather than fabricate).
 */
async function followerDeltas(bpId: string, start: Date, end: Date): Promise<Map<string | null, number>> {
  const startYmd = ymdIL(start);
  const endYmd = ymdIL(end);
  const floor = ymdIL(new Date(start.getTime() - 7 * 86400000)); // baseline tolerance, as socialKpis.ts
  const rows = await q<{ competitor_id: string | null; start_val: number | null; end_val: number | null }>(
    `SELECT competitor_id, split_part(metric_name, ':', 2) AS platform,
       (array_agg(metric_value ORDER BY snapshot_date DESC) FILTER (WHERE snapshot_date <= $2))[1] AS start_val,
       (array_agg(metric_value ORDER BY snapshot_date DESC) FILTER (WHERE snapshot_date > $2 AND snapshot_date <= $3))[1] AS end_val
     FROM metrics_snapshots
     WHERE linked_business = $1 AND metric_name LIKE 'followers:%' AND snapshot_date >= $4 AND snapshot_date <= $3
     GROUP BY competitor_id, platform`,
    bpId, startYmd, endYmd, floor,
  );
  const out = new Map<string | null, number>();
  for (const r of rows) {
    if (r.start_val == null || r.end_val == null) continue;
    out.set(r.competitor_id, (out.get(r.competitor_id) ?? 0) + (r.end_val - r.start_val));
  }
  return out;
}

const LIMITS_ALL = [
  'סטוריז נאספים מאינסטגרם בלבד (לא מפייסבוק)',
  'מודעות גוגל מגיעות ללא תאריך עלייה — נספרות לפי מועד הזיהוי הראשון',
];
const LIMITS_REVIEWS = [
  'אין היסטוריית דירוג למתחרים — מוצג הממוצע של הביקורות החדשות בתקופה',
  'חלק מהביקורות על העסק (ממקורות חיפוש ברשת) ללא תאריך פרסום אמיתי',
];

/**
 * Everything a report covers for one business over [start, end). Daily/weekly/monthly
 * all run the same competitor queries over their window, so a weekly report equals the
 * sum of that week's dailies without double-counting or gaps from a failed daily run.
 */
export async function buildReportData(bpId: string, type: ReportType, start: Date, end: Date) {
  const p = [bpId, start.toISOString(), end.toISOString()] as const;
  // ponytail: sequential awaits on purpose — runAgentForAll runs 4 businesses at once on an 8-connection pool.
  const competitors = await q<{ id: string; name: string; rating: number | null; review_count: number | null }>(
    `SELECT id, name, rating, review_count FROM competitors
     WHERE linked_business = $1 AND tracking_status = 'approved' AND COALESCE(not_relevant, false) = false
     ORDER BY name`,
    bpId,
  );

  const posts = await q(
    `SELECT competitor_id, platform, post_url, LEFT(caption, 200) AS caption, likes, comments_count,
            has_offer, analysis, ${ts('posted_at')} AS posted_at
     FROM competitor_posts WHERE linked_business = $1 AND ${inWindow('posted_at')}`, ...p,
  );
  const stories = await q(
    `SELECT competitor_id, media_type, has_offer, analysis, ${ts('posted_at')} AS posted_at
     FROM competitor_stories WHERE linked_business = $1 AND ${inWindow('posted_at')}`, ...p,
  );
  const newAds = await q(
    `SELECT competitor_id, platform, title, LEFT(body, 200) AS body, cta, link, has_offer, analysis,
            COALESCE(${ts('start_date')}, first_seen_at) AS started_at
     FROM competitor_ad_history WHERE linked_business = $1 AND ${newAdsWhere}`, ...p,
  );
  // "Active" = seen by a scan in the last 2 days of the period; is_active is only
  // cleared when a scan finds zero ads, so it goes stale for individual ads.
  const activeAds = await q<{ competitor_id: string; n: number }>(
    `SELECT competitor_id, COUNT(*)::int AS n FROM competitor_ad_history
     WHERE linked_business = $1 AND first_seen_at < $3::timestamptz
       AND last_seen_at >= $3::timestamptz - interval '2 days'
     GROUP BY competitor_id`, ...p,
  );
  // Price / promotion / website changes only exist as signals. otx_comp:* rows are
  // routed by sector, not business, so they can belong to someone else — excluded.
  const changes = await q(
    `SELECT category, summary, impact_level, ${ts('COALESCE(detected_at, created_date::text)')} AS detected_at
     FROM market_signals
     WHERE linked_business = $1 AND category = ANY($4::text[])
       AND COALESCE(source_description, '') NOT LIKE 'otx_comp:%'
       AND ${inWindow('COALESCE(detected_at, created_date::text)')}
     ORDER BY 4 DESC LIMIT 50`, ...p, REPORT_SIGNAL_CATEGORIES,
  );
  const followers = await followerDeltas(bpId, start, end);

  const withReviews = type !== 'daily';
  const reviews = withReviews
    ? await q(
      `SELECT linked_competitor, rating, response_status, topic_sentiment, LEFT(text, 200) AS text
       FROM reviews WHERE linked_business = $1 AND ${inWindow('created_at')}`, ...p,
    )
    : [];

  const postsBy = groupBy(posts, r => r.competitor_id);
  const storiesBy = groupBy(stories, r => r.competitor_id);
  const adsBy = groupBy(newAds, r => r.competitor_id);
  const reviewsBy = groupBy(reviews, r => r.linked_competitor);
  const activeBy = new Map(activeAds.map(r => [r.competitor_id, r.n]));

  const competitorBlocks = competitors.map(c => {
    const cp = postsBy.get(c.id) ?? [];
    const cs = storiesBy.get(c.id) ?? [];
    const ca = adsBy.get(c.id) ?? [];
    const offers = [
      ...cp.filter(x => x.has_offer).map(x => ({ source: 'post', platform: x.platform, url: x.post_url, at: x.posted_at, ...offerOf(x.analysis) })),
      ...cs.filter(x => x.has_offer).map(x => ({ source: 'story', platform: 'instagram', at: x.posted_at, ...offerOf(x.analysis) })),
      ...ca.filter(x => x.has_offer).map(x => ({ source: 'ad', platform: x.platform, url: x.link, at: x.started_at, ...offerOf(x.analysis) })),
    ];
    return {
      id: c.id,
      name: c.name,
      posts: postsSummary(cp),
      stories: { count: cs.length, with_offer: cs.filter(x => x.has_offer).length },
      ads: { new_count: ca.length, active_count: activeBy.get(c.id) ?? 0, new: ca.slice(0, 5).map(adItem) },
      offers: { count: offers.length, items: offers.slice(0, 5) },
      followers_delta: followers.get(c.id) ?? null,
      ...(withReviews ? {
        reviews: reviewStats(reviewsBy.get(c.id) ?? [], false),
        current_rating: c.rating,
        current_review_count: c.review_count,
      } : {}),
    };
  });

  // Totals come from the tracked-competitor blocks, not the raw row counts — the
  // queries above also return rows of untracked / not_relevant competitors.
  const sum = (f: (c: (typeof competitorBlocks)[number]) => number) => competitorBlocks.reduce((s, c) => s + f(c), 0);
  const ownReviews = withReviews ? reviewStats(reviewsBy.get(null) ?? [], true) : null;
  const totals = {
    posts: sum(c => c.posts.count),
    stories: sum(c => c.stories.count),
    new_ads: sum(c => c.ads.new_count),
    offers: sum(c => c.offers.count),
    changes: changes.length,
    ...(ownReviews ? { reviews: ownReviews.count + sum(c => c.reviews?.count ?? 0) } : {}),
  };

  return {
    period: { type, start: start.toISOString(), end: end.toISOString() },
    totals,
    competitors: competitorBlocks,
    changes,
    ...(ownReviews ? { own_reviews: ownReviews } : {}),
    ...(type === 'monthly' ? { own: await buildOwnActivity(p, followers.get(null) ?? null) } : {}),
    limits: withReviews ? [...LIMITS_ALL, ...LIMITS_REVIEWS] : LIMITS_ALL,
  };
}

/** The business's own activity over the window — monthly report only. */
async function buildOwnActivity(p: readonly [string, string, string], followersDelta: number | null) {
  const posts = await q(
    `SELECT platform, post_url, LEFT(caption, 200) AS caption, likes, comments_count, has_offer, analysis,
            ${ts('posted_at')} AS posted_at
     FROM business_posts WHERE linked_business = $1 AND ${inWindow('posted_at')}`, ...p,
  );
  const [ads] = await q<{ new_count: number }>(
    `SELECT COUNT(*)::int AS new_count FROM business_ad_history WHERE linked_business = $1 AND (
       (${inWindow('start_date')})
       OR (start_date IS NULL AND first_seen_at >= $2::timestamptz AND first_seen_at < $3::timestamptz))`, ...p,
  );
  const [published] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM organic_posts
     WHERE linked_business = $1 AND status = 'published' AND ${inWindow('published_at')}`, ...p,
  );
  const campaigns = await q(
    `SELECT title, platform, objective, status, actual_reach, actual_clicks, actual_leads, actual_spend_ils
     FROM campaigns WHERE linked_business = $1 AND ${inWindow('published_at')}
     ORDER BY published_at DESC LIMIT 10`, ...p,
  );
  const [leads] = await q<{ created: number; won: number; won_value: number | null }>(
    `SELECT COUNT(*) FILTER (WHERE created_date >= $2::timestamptz AND created_date < $3::timestamptz)::int AS created,
            COUNT(*) FILTER (WHERE status IN ('closed_won', 'completed') AND ${inWindow('closed_at')})::int AS won,
            SUM(COALESCE(deal_value, closed_value)) FILTER (WHERE status IN ('closed_won', 'completed') AND ${inWindow('closed_at')})::float AS won_value
     FROM leads WHERE linked_business = $1`, ...p,
  );
  const [conversations] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM conversations c
     JOIN meta_connections m ON m.id = c.meta_connection_id
     WHERE m.business_profile_id = $1 AND c.created_date >= $2::timestamptz AND c.created_date < $3::timestamptz`, ...p,
  );
  const [actions] = await q<{ n: number; revenue: number | null }>(
    `SELECT COUNT(*)::int AS n, SUM(revenue_impact)::float AS revenue FROM auto_actions
     WHERE linked_business = $1 AND status = 'completed' AND ${inWindow('executed_at')}`, ...p,
  );
  const health = await q<{ overall_score: number }>(
    `SELECT overall_score FROM health_scores
     WHERE linked_business = $1 AND created_date >= $2::timestamptz AND created_date < $3::timestamptz
     ORDER BY created_date`, ...p,
  );

  return {
    posts: { ...postsSummary(posts), with_offer: posts.filter(x => x.has_offer).length },
    ads: { new_count: ads?.new_count ?? 0 },
    published_from_app: published?.n ?? 0,
    campaigns,
    leads: { created: leads?.created ?? 0, won: leads?.won ?? 0, won_value: leads?.won_value ?? null },
    conversations: conversations?.n ?? 0,
    auto_actions: { completed: actions?.n ?? 0, revenue_impact: actions?.revenue ?? null },
    health_score: health.length ? { start: health[0].overall_score, end: health[health.length - 1].overall_score } : null,
    followers_delta: followersDelta,
  };
}

/** True when the period has nothing worth narrating — the handler then skips the LLM. */
export function isEmptyReport(data: Awaited<ReturnType<typeof buildReportData>>): boolean {
  const t = data.totals as Record<string, number>;
  const own = (data as any).own;
  const ownActivity = own
    ? own.posts.count + own.ads.new_count + own.published_from_app + own.campaigns.length
      + own.leads.created + own.conversations + own.auto_actions.completed
    : 0;
  return Object.values(t).every(v => v === 0) && ownActivity === 0;
}
