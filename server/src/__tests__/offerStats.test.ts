/**
 * Unit tests — computeOfferStats (pure function extracted from
 * analyzeSocialPosts.ts's analyzeCompetitorContent()).
 */
import { computeOfferStats, OfferAnalysisItem } from '../lib/offerStats';

function post(overrides: Partial<OfferAnalysisItem> & { a: OfferAnalysisItem['a'] }): OfferAnalysisItem {
  return { type: 'post', posted_at: null, likes: null, comments_count: null, ...overrides };
}
function ad(overrides: Partial<OfferAnalysisItem> & { a: OfferAnalysisItem['a'] }): OfferAnalysisItem {
  return { type: 'ad', first_seen_at: null, ...overrides };
}

describe('computeOfferStats', () => {
  test('returns null when offerItems is empty', () => {
    expect(computeOfferStats([], [])).toBeNull();
  });

  test('computes peak day-of-week and average interval between offers', () => {
    // Two Sundays a week apart (2024-01-07, 2024-01-14 are both Sundays)
    const items: OfferAnalysisItem[] = [
      post({ posted_at: '2024-01-07T10:00:00Z', a: { has_offer: true, offer_mechanic: 'discount' } }),
      post({ posted_at: '2024-01-14T10:00:00Z', a: { has_offer: true, offer_mechanic: 'discount' } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.total_offers).toBe(2);
    expect(result.peak_day).toBe('ראשון');
    expect(result.peak_day_count).toBe(2);
    expect(result.avg_interval_days).toBe(7);
  });

  test('does not compute peak_day/avg_interval with fewer than 2 dated offers', () => {
    const items: OfferAnalysisItem[] = [
      post({ posted_at: '2024-01-07T10:00:00Z', a: { has_offer: true, offer_mechanic: 'discount' } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.peak_day).toBeNull();
    expect(result.avg_interval_days).toBeNull();
  });

  test('tallies mechanic/value_framing/audience_intent/redemption breakdowns, sorted desc', () => {
    const items: OfferAnalysisItem[] = [
      post({ a: { has_offer: true, offer_mechanic: 'discount', offer_value_framing: 'savings', offer_audience_intent: 'new_customers', offer_redemption: 'in_store' } }),
      post({ a: { has_offer: true, offer_mechanic: 'discount', offer_value_framing: 'savings', offer_audience_intent: 'existing_customers', offer_redemption: 'in_store' } }),
      post({ a: { has_offer: true, offer_mechanic: 'bogo', offer_value_framing: 'urgency', offer_audience_intent: 'new_customers', offer_redemption: 'online' } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.mechanic_breakdown).toEqual([{ value: 'discount', count: 2 }, { value: 'bogo', count: 1 }]);
    expect(result.value_framing_breakdown[0]).toEqual({ value: 'savings', count: 2 });
    expect(result.audience_intent_breakdown[0]).toEqual({ value: 'new_customers', count: 2 });
    expect(result.redemption_breakdown[0]).toEqual({ value: 'in_store', count: 2 });
  });

  test('caps redemption_breakdown at top 3 entries', () => {
    const items: OfferAnalysisItem[] = [
      post({ a: { has_offer: true, offer_redemption: 'a' } }),
      post({ a: { has_offer: true, offer_redemption: 'b' } }),
      post({ a: { has_offer: true, offer_redemption: 'c' } }),
      post({ a: { has_offer: true, offer_redemption: 'd' } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.redemption_breakdown).toHaveLength(3);
  });

  test('computes urgency/conditions/in_image percentages', () => {
    const items: OfferAnalysisItem[] = [
      post({ a: { has_offer: true, offer_urgency: true, offer_conditions: true, offer_in_image: false } }),
      post({ a: { has_offer: true, offer_urgency: false, offer_conditions: false, offer_in_image: true } }),
      post({ a: { has_offer: true, offer_urgency: true, offer_conditions: false, offer_in_image: false } }),
      post({ a: { has_offer: true, offer_urgency: false, offer_conditions: false, offer_in_image: false } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.urgency_pct).toBe(50);
    expect(result.conditions_pct).toBe(25);
    expect(result.in_image_pct).toBe(25);
  });

  test('computes performance: offer posts vs regular (non-offer) posts, ads excluded', () => {
    const offerPosts: OfferAnalysisItem[] = [
      post({ likes: 100, comments_count: 10, a: { has_offer: true } }),
      post({ likes: 200, comments_count: 20, a: { has_offer: true } }),
    ];
    const regularPosts: OfferAnalysisItem[] = [
      post({ likes: 30, comments_count: 3, a: { has_offer: false } }),
      post({ likes: 50, comments_count: 5, a: { has_offer: false } }),
    ];
    const offerAd = ad({ a: { has_offer: true } }); // ads carry no engagement metrics
    const allItems = [...offerPosts, ...regularPosts, offerAd];
    const offerItems = [...offerPosts, offerAd];

    const result = computeOfferStats(offerItems, allItems)!;
    expect(result.performance).toEqual({
      avg_likes_offer_posts: 150,
      avg_likes_regular_posts: 40,
      avg_comments_offer_posts: 15,
      avg_comments_regular_posts: 4,
    });
  });

  test('performance is null when no posts carry likes data (ads-only offers)', () => {
    const items: OfferAnalysisItem[] = [ad({ a: { has_offer: true } })];
    const result = computeOfferStats(items, items)!;
    expect(result.performance).toBeNull();
  });

  test('pools items across multiple competitors (order-independent aggregation)', () => {
    const items: OfferAnalysisItem[] = [
      post({ posted_at: '2024-02-01T00:00:00Z', a: { has_offer: true, offer_mechanic: 'discount' } }), // Thursday
      post({ posted_at: '2024-02-08T00:00:00Z', a: { has_offer: true, offer_mechanic: 'discount' } }), // Thursday
      ad({ first_seen_at: '2024-02-15T00:00:00Z', a: { has_offer: true, offer_mechanic: 'bogo' } }),
    ];
    const result = computeOfferStats(items, items)!;
    expect(result.total_offers).toBe(3);
    expect(result.mechanic_breakdown[0]).toEqual({ value: 'discount', count: 2 });
  });
});
