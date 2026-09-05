// Deterministic offer-breakdown stats — computed in JS from the structured
// per-item vision analysis (analyzePostCreative's offer_* fields), not guessed by
// the LLM. Extracted out of analyzeSocialPosts.ts's analyzeCompetitorContent() so
// it can be reused, unchanged, by the pooled cross-competitor "Offers Landscape"
// aggregation (analyzeOffersLandscape.ts) — same algorithm, just fed a pooled set
// of items instead of one competitor's items.

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** One post or ad's structured per-item vision analysis, tagged with the fields
 * computeOfferStats needs (dates for cadence, likes/comments for performance). */
export interface OfferAnalysisItem {
  type: 'post' | 'ad';
  posted_at?: Date | string | null;     // posts
  first_seen_at?: Date | string | null; // ads
  likes?: number | null;
  comments_count?: number | null;
  a: {
    has_offer?: boolean;
    offer_details?: string;
    offer_mechanic?: string;
    offer_value_framing?: string;
    offer_audience_intent?: string;
    offer_redemption?: string;
    offer_urgency?: boolean;
    offer_conditions?: boolean;
    offer_in_image?: boolean;
    topic?: string;
    [key: string]: any;
  };
}

export interface OfferPerformance {
  avg_likes_offer_posts: number | null;
  avg_likes_regular_posts: number | null;
  avg_comments_offer_posts: number | null;
  avg_comments_regular_posts: number | null;
}

export interface OfferBreakdownEntry {
  value: string;
  count: number;
}

export interface OfferStats {
  total_offers: number;
  peak_day: string | null;
  peak_day_count: number;
  avg_interval_days: number | null;
  mechanic_breakdown: OfferBreakdownEntry[];
  value_framing_breakdown: OfferBreakdownEntry[];
  audience_intent_breakdown: OfferBreakdownEntry[];
  redemption_breakdown: OfferBreakdownEntry[];
  // 'organic' (regular post) vs 'paid' (ad) — which channel offers actually run through.
  channel_breakdown: OfferBreakdownEntry[];
  urgency_pct: number;
  conditions_pct: number;
  in_image_pct: number;
  performance: OfferPerformance | null;
}

function tally(items: OfferAnalysisItem[], key: string): OfferBreakdownEntry[] {
  const counts: Record<string, number> = {};
  for (const it of items) {
    const v = it.a[key];
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([value, count]) => ({ value, count }));
}

function avg(arr: any[], key: string): number | null {
  return arr.length ? Math.round(arr.reduce((s, x) => s + x[key], 0) / arr.length) : null;
}

/**
 * Computes the deterministic offer stats (peak day-of-week, average interval
 * between offers, mechanic/value-framing/audience-intent/redemption breakdowns,
 * urgency/conditions/in-image percentages, and offer-vs-regular-post performance)
 * from a pooled set of has_offer=true analyzed items.
 *
 * @param offerItems Items where `a.has_offer` is true — the population the stats
 *   are computed over. May be from one competitor or pooled across many.
 * @param allAnalyzedItems ALL analyzed items (offer and non-offer), used only for
 *   the "regular" (non-offer) baseline in the performance comparison.
 * @returns null when `offerItems` is empty (nothing to compute yet).
 */
export function computeOfferStats(
  offerItems: OfferAnalysisItem[],
  allAnalyzedItems: OfferAnalysisItem[],
): OfferStats | null {
  if (!offerItems || offerItems.length === 0) return null;

  const offerDates = offerItems
    .map(it => it.posted_at ?? it.first_seen_at)
    .filter((d): d is Date | string => !!d)
    .map(d => new Date(d))
    .sort((x, y) => x.getTime() - y.getTime());

  let peakDay: string | null = null;
  let peakDayCount = 0;
  let avgIntervalDays: number | null = null;
  if (offerDates.length >= 2) {
    const dayBuckets = new Array(7).fill(0);
    offerDates.forEach(d => dayBuckets[d.getDay()]++);
    const peakDayIdx = dayBuckets.indexOf(Math.max(...dayBuckets));
    peakDay = DAY_NAMES_HE[peakDayIdx];
    peakDayCount = dayBuckets[peakDayIdx];
    const intervals: number[] = [];
    for (let i = 1; i < offerDates.length; i++) intervals.push((offerDates[i].getTime() - offerDates[i - 1].getTime()) / 86400000);
    avgIntervalDays = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
  }

  const urgencyCount    = offerItems.filter(o => o.a.offer_urgency).length;
  const conditionsCount = offerItems.filter(o => o.a.offer_conditions).length;
  const inImageCount    = offerItems.filter(o => o.a.offer_in_image).length;

  // Performance signal — only posts carry engagement metrics (ads don't).
  // Compares offer posts vs regular (non-offer) posts to see if promotions actually land better.
  const offerPosts   = offerItems.filter(it => it.type === 'post');
  const regularPosts = allAnalyzedItems.filter(it => it.type === 'post' && !it.a.has_offer);
  const avgLikesOffer      = avg(offerPosts.filter(p => p.likes != null), 'likes');
  const avgLikesRegular    = avg(regularPosts.filter(p => p.likes != null), 'likes');
  const avgCommentsOffer   = avg(offerPosts.filter(p => p.comments_count != null), 'comments_count');
  const avgCommentsRegular = avg(regularPosts.filter(p => p.comments_count != null), 'comments_count');
  const performance: OfferPerformance | null = (avgLikesOffer != null || avgLikesRegular != null) ? {
    avg_likes_offer_posts: avgLikesOffer, avg_likes_regular_posts: avgLikesRegular,
    avg_comments_offer_posts: avgCommentsOffer, avg_comments_regular_posts: avgCommentsRegular,
  } : null;

  const channelCounts: Record<string, number> = { organic: 0, paid: 0 };
  for (const it of offerItems) channelCounts[it.type === 'ad' ? 'paid' : 'organic']++;
  const channelBreakdown = Object.entries(channelCounts)
    .filter(([, count]) => count > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([value, count]) => ({ value, count }));

  return {
    total_offers: offerItems.length,
    peak_day: peakDay,
    peak_day_count: peakDayCount,
    avg_interval_days: avgIntervalDays,
    mechanic_breakdown: tally(offerItems, 'offer_mechanic'),
    value_framing_breakdown: tally(offerItems, 'offer_value_framing'),
    audience_intent_breakdown: tally(offerItems, 'offer_audience_intent'),
    redemption_breakdown: tally(offerItems, 'offer_redemption').slice(0, 3),
    channel_breakdown: channelBreakdown,
    urgency_pct: Math.round((urgencyCount / offerItems.length) * 100),
    conditions_pct: Math.round((conditionsCount / offerItems.length) * 100),
    in_image_pct: Math.round((inImageCount / offerItems.length) * 100),
    performance,
  };
}
