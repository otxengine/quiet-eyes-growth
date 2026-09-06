// Deterministic content-trend breakdown stats — computed in JS from the
// structured per-post vision analysis (analyzePostCreative's content_pillar/
// audience_action_driver/platform fields), not guessed by the LLM. Same
// "rollup is authoritative, LLM narrative is gloss only" discipline as
// offerStats.ts — shared by the pooled cross-competitor content-trends
// aggregation (analyzeContentTrends.ts) and the own-business version
// (analyzeTopOwnPosts.ts), same algorithm, just fed a different post set.

export interface ContentTrendBreakdownEntry {
  value: string;
  count: number;
}

export interface ContentTrendPostLike {
  platform: string;
  content_pillar?: string | null;
  audience_action_driver?: string | null;
}

export interface ContentTrendStats {
  total_posts: number;
  content_pillar_breakdown: ContentTrendBreakdownEntry[];
  audience_action_driver_breakdown: ContentTrendBreakdownEntry[];
  platform_breakdown: ContentTrendBreakdownEntry[];
}

function tally(items: ContentTrendPostLike[], key: 'content_pillar' | 'audience_action_driver' | 'platform'): ContentTrendBreakdownEntry[] {
  const counts: Record<string, number> = {};
  for (const it of items) {
    const v = it[key];
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([value, count]) => ({ value, count }));
}

/**
 * Computes the deterministic content-trend stats (content pillar / audience
 * action driver / platform breakdowns) from a set of outlier posts.
 * @returns null when `posts` is empty (nothing to compute yet).
 */
export function computeContentTrendStats(posts: ContentTrendPostLike[]): ContentTrendStats | null {
  if (!posts || posts.length === 0) return null;
  return {
    total_posts: posts.length,
    content_pillar_breakdown: tally(posts, 'content_pillar'),
    audience_action_driver_breakdown: tally(posts, 'audience_action_driver'),
    platform_breakdown: tally(posts, 'platform'),
  };
}

// The 6 topics a content-trends insight is broken into — shared contract
// between synthesizeContentTrends.ts (pooled competitors) and
// synthesizeOutlierInsight.ts (own business). Order here is the order shown
// in the UI.
export const CONTENT_TRENDS_TOPICS = [
  'content_themes',
  'hook_patterns',
  'engagement_drivers',
  'visual_style',
  'platform_performance',
  'improvement_opportunity',
] as const;

export type ContentTrendsTopic = typeof CONTENT_TRENDS_TOPICS[number];
export type ContentTrendsInsight = Record<ContentTrendsTopic, string | null>;

/** Renders a breakdown array as "a (x/n), b (y/n)" for the top `limit` entries — used to
 * give the LLM more than just the #1 value so it can ground a topic in the real spread. */
export function topEntries(breakdown: ContentTrendBreakdownEntry[], total: number, limit = 3): string {
  if (!breakdown.length) return '—';
  return breakdown.slice(0, limit).map(e => `${e.value} (${e.count}/${total})`).join(', ');
}

/** Normalizes a raw LLM object into a fully-keyed ContentTrendsInsight (missing/non-string
 * values become null), and returns null altogether if every topic came back empty. */
export function normalizeContentTrendsInsight(raw: any): ContentTrendsInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const insight = {} as ContentTrendsInsight;
  for (const topic of CONTENT_TRENDS_TOPICS) {
    const v = raw[topic];
    insight[topic] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  return Object.values(insight).some(v => v) ? insight : null;
}

/**
 * Derives a single backward-compatible paragraph from the structured insight,
 * for older consumers that render one plain-text field (BusinessSocialSnapshot.jsx,
 * SocialCompetition.jsx, CompetitorContentTrends.jsx) — joins the "copy" topics
 * (content themes, hook patterns, engagement drivers) since that trio together
 * covers what those older single-paragraph fields used to describe.
 */
export function deriveCopySummary(insight: ContentTrendsInsight | null): string | null {
  if (!insight) return null;
  const parts = [insight.content_themes, insight.hook_patterns, insight.engagement_drivers].filter((v): v is string => !!v);
  return parts.length ? parts.join(' ') : null;
}
