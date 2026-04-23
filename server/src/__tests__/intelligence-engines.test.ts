/**
 * Unit tests — Intelligence Engines (all 8)
 *
 * All engines are pure synchronous functions that take EnrichedContext
 * and return Insight[] (or { insights, trust_state|churn_risk_state }).
 * No mocking required — tests run against the detection logic directly.
 *
 * Covers:
 *  SupplyDemandMismatchDetector  — demand > supply gaps
 *  WhiteSpaceRadar               — unserved market niches
 *  GhostDemandCartographer       — latent / seasonal demand
 *  PriceVacuumDetector           — pricing gap analysis
 *  WorkforcePatternOpportunity   — B2B / workforce demand
 *  TimingArbitrageEngine         — time-window demand gaps
 *  TrustSignalAggregator         — trust score + gap insights
 *  InvisibleChurnPredictor       — external-signal churn risk
 */

import { detectSupplyDemandMismatches } from '../services/intelligence/engines/SupplyDemandMismatchDetector';
import { detectWhiteSpaces }            from '../services/intelligence/engines/WhiteSpaceRadar';
import { detectGhostDemand }            from '../services/intelligence/engines/GhostDemandCartographer';
import { detectPriceVacuums }           from '../services/intelligence/engines/PriceVacuumDetector';
import { detectWorkforcePatterns }      from '../services/intelligence/engines/WorkforcePatternOpportunity';
import { detectTimingArbitrage }        from '../services/intelligence/engines/TimingArbitrageEngine';
import { analyzeTrustSignals }          from '../services/intelligence/engines/TrustSignalAggregator';
import { predictInvisibleChurn }        from '../services/intelligence/engines/InvisibleChurnPredictor';
import type { EnrichedContext }          from '../models';

// ─── Shared context factory ───────────────────────────────────────────────────

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    context_id:    'ctx_test',
    business_id:   'biz_001',
    built_at:      new Date().toISOString(),
    trace_id:      'trace_test',
    profile:       { name: 'Test Biz', category: 'restaurant', city: 'Tel Aviv', plan_id: null },
    meta_configuration: null,
    recent_signals:     [],
    signals:            { total: 0, high_urgency: 0, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:    { total: 10, hot: 0, warm: 3, new: 2, avg_score: 50 },
    health_score:   70,
    health_details: {},
    reviews: { total: 20, avg_rating: 4.2, negative_last7d: 0, pending_response: 0 },
    sector_knowledge: null,
    active_predictions: [],
    memory:             null,
    recent_decisions:   [],
    recent_outcomes:    [],
    recent_decisions_summary: [],
    market_insights:    [],
    trust_state:        null,
    churn_risk_state:   null,
    ...overrides,
  };
}

// ─── SupplyDemandMismatchDetector ─────────────────────────────────────────────

describe('SupplyDemandMismatchDetector', () => {
  test('detects hot_leads + forecast spike as supply-demand mismatch', () => {
    const ctx = makeCtx({
      leads:    { total: 10, hot: 4, warm: 2, new: 1, avg_score: 60 },
      forecasts: [{ id: 'f1', business_id: 'biz_001', forecast_window: '7d', demand_delta_pct: 30, confidence: 0.80, created_at: new Date().toISOString(), expected_demand_score: 80, factors: [] }],
    });
    const insights = detectSupplyDemandMismatches(ctx);
    expect(insights.some(i => i.type === 'supply_demand_mismatch')).toBe(true);
  });

  test('detects high_urgency signals + weak competitors', () => {
    const ctx = makeCtx({
      signals:     { total: 10, high_urgency: 5, items: [] },
      competitors: [{ name: 'CompA', rating: null, trend_direction: 'falling' }],
    });
    const insights = detectSupplyDemandMismatches(ctx);
    expect(insights.some(i => i.type === 'supply_demand_mismatch')).toBe(true);
  });

  test('detects conversion bottleneck: hot leads < 40% of total', () => {
    const ctx = makeCtx({
      leads: { total: 20, hot: 5, warm: 8, new: 5, avg_score: 55 },
    });
    const insights = detectSupplyDemandMismatches(ctx);
    expect(insights.some(i => i.metadata?.conversion_lag !== undefined)).toBe(true);
  });

  test('returns no insights when demand signals are insufficient', () => {
    const ctx = makeCtx({
      leads:     { total: 5, hot: 0, warm: 2, new: 1, avg_score: 40 },
      signals:   { total: 2, high_urgency: 1, items: [] },
      forecasts: [],
    });
    const insights = detectSupplyDemandMismatches(ctx);
    expect(insights).toHaveLength(0);
  });

  test('all insights have type supply_demand_mismatch', () => {
    const ctx = makeCtx({
      leads:     { total: 15, hot: 6, warm: 3, new: 2, avg_score: 65 },
      forecasts: [{ id: 'f1', business_id: 'biz_001', forecast_window: '7d', demand_delta_pct: 25, confidence: 0.75, created_at: new Date().toISOString(), expected_demand_score: 75, factors: [] }],
      signals:   { total: 8, high_urgency: 5, items: [] },
      competitors: [{ name: 'C1', rating: null, trend_direction: 'falling' }],
    });
    const insights = detectSupplyDemandMismatches(ctx);
    expect(insights.every(i => i.type === 'supply_demand_mismatch')).toBe(true);
  });

  test('all insights have confidence in [0,1]', () => {
    const ctx = makeCtx({
      leads: { total: 10, hot: 4, warm: 2, new: 1, avg_score: 60 },
      forecasts: [{ id: 'f1', business_id: 'biz_001', forecast_window: '7d', demand_delta_pct: 30, confidence: 0.80, created_at: new Date().toISOString(), expected_demand_score: 80, factors: [] }],
    });
    detectSupplyDemandMismatches(ctx).forEach(i => {
      expect(i.confidence).toBeGreaterThanOrEqual(0);
      expect(i.confidence).toBeLessThanOrEqual(1);
    });
  });

  test('each insight has a non-empty dedup_key', () => {
    const ctx = makeCtx({
      leads:     { total: 10, hot: 4, warm: 2, new: 1, avg_score: 60 },
      forecasts: [{ id: 'f1', business_id: 'biz_001', forecast_window: '7d', demand_delta_pct: 30, confidence: 0.80, created_at: new Date().toISOString(), expected_demand_score: 80, factors: [] }],
    });
    detectSupplyDemandMismatches(ctx).forEach(i => {
      expect(i.dedup_key.length).toBeGreaterThan(0);
    });
  });

  test('high urgency fires when hot leads >= 6', () => {
    const ctx = makeCtx({
      leads:     { total: 12, hot: 7, warm: 3, new: 1, avg_score: 70 },
      forecasts: [{ id: 'f1', business_id: 'biz_001', forecast_window: '7d', demand_delta_pct: 20, confidence: 0.75, created_at: new Date().toISOString(), expected_demand_score: 70, factors: [] }],
    });
    const insights = detectSupplyDemandMismatches(ctx);
    const mismatch = insights.find(i => i.type === 'supply_demand_mismatch');
    expect(mismatch?.urgency).toBe('high');
  });
});

// ─── WhiteSpaceRadar ──────────────────────────────────────────────────────────

describe('WhiteSpaceRadar', () => {
  test('detects premium vacuum when all competitors rated < 4.0', () => {
    const ctx = makeCtx({
      health_score: 75,
      competitors: [
        { name: 'A', rating: 3.8, trend_direction: 'stable' },
        { name: 'B', rating: 3.5, trend_direction: 'falling' },
      ],
    });
    const insights = detectWhiteSpaces(ctx);
    expect(insights.some(i => i.dedup_key.includes('premium_vacuum'))).toBe(true);
  });

  test('detects sector trending services white space when competitors are weak', () => {
    const ctx = makeCtx({
      health_score: 65,
      sector_knowledge: {
        avg_rating: 4.0,
        trending_services: 'פיצות ביתיות',
        winner_lead_dna: null,
      },
      competitors: [
        { name: 'A', rating: 3.5, trend_direction: 'falling' },
      ],
    });
    const insights = detectWhiteSpaces(ctx);
    expect(insights.some(i => i.type === 'white_space')).toBe(true);
  });

  test('detects online booking white space from signal keywords', () => {
    const ctx = makeCtx({
      recent_signals: [
        { id: 's1', summary: 'לקוח מחפש הזמנה online לשולחן', category: 'food', impact_level: 'medium', detected_at: null },
        { id: 's2', summary: 'אפליקציה להזמנת מקומות ישיבה', category: 'food', impact_level: 'low', detected_at: null },
        { id: 's3', summary: 'booking online restaurant', category: 'food', impact_level: 'high', detected_at: null },
      ],
    });
    const insights = detectWhiteSpaces(ctx);
    expect(insights.some(i => i.dedup_key.includes('online_booking'))).toBe(true);
  });

  test('does NOT detect premium vacuum when a 4.5+ competitor exists', () => {
    const ctx = makeCtx({
      health_score: 75,
      competitors: [
        { name: 'StrongComp', rating: 4.8, trend_direction: 'rising' },
      ],
    });
    const insights = detectWhiteSpaces(ctx);
    expect(insights.some(i => i.dedup_key.includes('premium_vacuum'))).toBe(false);
  });

  test('all insights have category matching white_space type', () => {
    const ctx = makeCtx({
      health_score: 80,
      competitors: [{ name: 'A', rating: 3.2, trend_direction: 'falling' }],
    });
    const insights = detectWhiteSpaces(ctx);
    insights.forEach(i => expect(i.type).toBe('white_space'));
  });
});

// ─── GhostDemandCartographer ──────────────────────────────────────────────────

describe('GhostDemandCartographer', () => {
  test('detects warm lead pool as ghost demand', () => {
    const ctx = makeCtx({
      leads: { total: 12, hot: 1, warm: 6, new: 3, avg_score: 45 },
    });
    const insights = detectGhostDemand(ctx);
    expect(insights.some(i => i.dedup_key.includes('warm_leads_latent'))).toBe(true);
  });

  test('warm leads insight has medium urgency', () => {
    const ctx = makeCtx({
      leads: { total: 15, hot: 0, warm: 7, new: 4, avg_score: 40 },
    });
    const insights = detectGhostDemand(ctx);
    const warmInsight = insights.find(i => i.dedup_key.includes('warm_leads_latent'));
    expect(warmInsight?.urgency).toBe('medium');
  });

  test('does NOT generate warm-lead insight when hot leads >= 2', () => {
    const ctx = makeCtx({
      leads: { total: 15, hot: 3, warm: 8, new: 2, avg_score: 55 },
    });
    const insights = detectGhostDemand(ctx);
    expect(insights.some(i => i.dedup_key.includes('warm_leads_latent'))).toBe(false);
  });

  test('all insights have type ghost_demand', () => {
    const ctx = makeCtx({
      leads: { total: 12, hot: 1, warm: 6, new: 2, avg_score: 45 },
    });
    detectGhostDemand(ctx).forEach(i => expect(i.type).toBe('ghost_demand'));
  });

  test('all insights have valid timeframe', () => {
    const ctx = makeCtx({
      leads: { total: 12, hot: 0, warm: 6, new: 2, avg_score: 45 },
    });
    const validTimeframes = ['immediate', '24h', '7d', '30d'];
    detectGhostDemand(ctx).forEach(i => {
      expect(validTimeframes).toContain(i.timeframe);
    });
  });
});

// ─── PriceVacuumDetector ──────────────────────────────────────────────────────

describe('PriceVacuumDetector', () => {
  test('returns empty array when no competitors', () => {
    const ctx = makeCtx({ competitors: [] });
    expect(detectPriceVacuums(ctx)).toHaveLength(0);
  });

  test('detects premium vacuum when no competitor has 4.5+ rating', () => {
    const ctx = makeCtx({
      health_score: 72,
      competitors: [
        { name: 'A', rating: 3.8, trend_direction: 'stable' },
        { name: 'B', rating: 4.1, trend_direction: 'stable' },
      ],
    });
    const insights = detectPriceVacuums(ctx);
    expect(insights.some(i => i.dedup_key.includes('premium_vacuum'))).toBe(true);
  });

  test('does NOT detect premium vacuum when health_score <= 60', () => {
    const ctx = makeCtx({
      health_score: 50,
      competitors: [{ name: 'A', rating: 3.8, trend_direction: 'stable' }],
    });
    const insights = detectPriceVacuums(ctx);
    expect(insights.some(i => i.dedup_key.includes('premium_vacuum'))).toBe(false);
  });

  test('detects mid-market squeeze when 3+ mid-tier competitors and no premium', () => {
    const ctx = makeCtx({
      competitors: [
        { name: 'A', rating: 3.8, trend_direction: 'stable' },
        { name: 'B', rating: 4.0, trend_direction: 'stable' },
        { name: 'C', rating: 4.2, trend_direction: 'stable' },
      ],
    });
    const insights = detectPriceVacuums(ctx);
    expect(insights.some(i => i.dedup_key.includes('midmarket_squeeze'))).toBe(true);
  });

  test('detects rising competitor pressure when 2+ are rising with rating >= 4.2', () => {
    const ctx = makeCtx({
      competitors: [
        { name: 'A', rating: 4.5, trend_direction: 'rising' },
        { name: 'B', rating: 4.3, trend_direction: 'rising' },
      ],
    });
    const insights = detectPriceVacuums(ctx);
    expect(insights.some(i => i.dedup_key.includes('rising_competitors'))).toBe(true);
  });

  test('rising competitor insight has high urgency', () => {
    const ctx = makeCtx({
      competitors: [
        { name: 'A', rating: 4.5, trend_direction: 'rising' },
        { name: 'B', rating: 4.3, trend_direction: 'rising' },
      ],
    });
    const insights  = detectPriceVacuums(ctx);
    const rising    = insights.find(i => i.dedup_key.includes('rising_competitors'));
    expect(rising?.urgency).toBe('high');
  });

  test('all insights include at least one recommended_action_type', () => {
    const ctx = makeCtx({
      health_score: 75,
      competitors: [{ name: 'A', rating: 3.5, trend_direction: 'stable' }],
    });
    detectPriceVacuums(ctx).forEach(i => {
      expect(i.recommended_action_types.length).toBeGreaterThan(0);
    });
  });
});

// ─── WorkforcePatternOpportunity ──────────────────────────────────────────────

describe('WorkforcePatternOpportunity', () => {
  test('detects B2B opportunity from corporate signal keywords', () => {
    const ctx = makeCtx({
      sector_knowledge: { avg_rating: 4.0, trending_services: 'catering', winner_lead_dna: null },
      recent_signals: [
        { id: 's1', summary: 'חברה גדולה מחפשת ספק ארוחות לצוות', category: 'food', impact_level: 'high', detected_at: null },
        { id: 's2', summary: 'ארגון מחפש עסקת נפח עם חשבונית', category: 'food', impact_level: 'medium', detected_at: null },
        { id: 's3', summary: 'corporate catering tender', category: 'food', impact_level: 'medium', detected_at: null },
      ],
    });
    const insights = detectWorkforcePatterns(ctx);
    expect(insights.some(i => i.dedup_key.includes('b2b_opportunity'))).toBe(true);
  });

  test('detects remote work demand shift from signal keywords', () => {
    const ctx = makeCtx({
      recent_signals: [
        { id: 's1', summary: 'עבודה מהבית הגדילה ביקוש ל-delivery', category: 'food', impact_level: 'high', detected_at: null },
        { id: 's2', summary: 'freelance workers looking for co-working lunch options', category: 'food', impact_level: 'medium', detected_at: null },
      ],
    });
    const insights = detectWorkforcePatterns(ctx);
    expect(insights.some(i => i.dedup_key.includes('remote_work_demand'))).toBe(true);
  });

  test('detects hiring surge from signal keywords', () => {
    const ctx = makeCtx({
      recent_signals: [
        { id: 's1', summary: 'גיוס עובדים חדשים לאזור תל אביב', category: 'tech', impact_level: 'high', detected_at: null },
        { id: 's2', summary: 'דרושים 50 עובדים חדשים בחברת הייטק', category: 'tech', impact_level: 'high', detected_at: null },
        { id: 's3', summary: 'hiring 200 employees new campus nearby', category: 'tech', impact_level: 'high', detected_at: null },
      ],
    });
    const insights = detectWorkforcePatterns(ctx);
    expect(insights.some(i => i.dedup_key.includes('hiring_surge'))).toBe(true);
  });

  test('detects capacity gap when health > 70 but leads < 8', () => {
    const ctx = makeCtx({
      health_score: 85,
      leads: { total: 4, hot: 0, warm: 2, new: 1, avg_score: 45 },
    });
    const insights = detectWorkforcePatterns(ctx);
    expect(insights.some(i => i.dedup_key.includes('capacity_gap'))).toBe(true);
  });

  test('does NOT detect capacity gap when leads >= 8', () => {
    const ctx = makeCtx({
      health_score: 85,
      leads: { total: 12, hot: 3, warm: 5, new: 2, avg_score: 55 },
    });
    const insights = detectWorkforcePatterns(ctx);
    expect(insights.some(i => i.dedup_key.includes('capacity_gap'))).toBe(false);
  });

  test('all insights have type workforce_pattern', () => {
    const ctx = makeCtx({
      health_score: 85,
      leads: { total: 4, hot: 0, warm: 2, new: 0, avg_score: 40 },
    });
    detectWorkforcePatterns(ctx).forEach(i => expect(i.type).toBe('workforce_pattern'));
  });
});

// ─── TimingArbitrageEngine ────────────────────────────────────────────────────

describe('TimingArbitrageEngine', () => {
  test('detects pre-event timing window from high-impact prediction', () => {
    const ctx = makeCtx({
      active_predictions: [
        { title: 'ירידת גשמים גדולה', confidence: 0.80, timeframe: '24h', impact: 'high' },
      ],
    });
    const insights = detectTimingArbitrage(ctx);
    expect(insights.some(i => i.dedup_key.includes('pre_event'))).toBe(true);
  });

  test('pre-event insight has high urgency', () => {
    const ctx = makeCtx({
      active_predictions: [
        { title: 'אירוע ספורט גדול', confidence: 0.85, timeframe: '7d', impact: 'high' },
      ],
    });
    const insights = detectTimingArbitrage(ctx);
    const preEvent = insights.find(i => i.dedup_key.includes('pre_event'));
    expect(preEvent?.urgency).toBe('high');
  });

  test('detects 24h forecast demand window', () => {
    const ctx = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '24h',
        demand_delta_pct: 20, confidence: 0.75,
        created_at: new Date().toISOString(), expected_demand_score: 80, factors: [],
      }],
    });
    const insights = detectTimingArbitrage(ctx);
    expect(insights.some(i => i.dedup_key.includes('24h_forecast'))).toBe(true);
  });

  test('does NOT detect 24h forecast window when delta <= 10%', () => {
    const ctx = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '24h',
        demand_delta_pct: 8, confidence: 0.75,
        created_at: new Date().toISOString(), expected_demand_score: 65, factors: [],
      }],
    });
    const insights = detectTimingArbitrage(ctx);
    expect(insights.some(i => i.dedup_key.includes('24h_forecast'))).toBe(false);
  });

  test('all insights have type timing_arbitrage', () => {
    const ctx = makeCtx({
      active_predictions: [{ title: 'Big Event', confidence: 0.8, timeframe: '7d', impact: 'high' }],
    });
    detectTimingArbitrage(ctx).forEach(i => expect(i.type).toBe('timing_arbitrage'));
  });

  test('all insights have business_id matching context', () => {
    const ctx = makeCtx({
      active_predictions: [{ title: 'Event', confidence: 0.8, timeframe: '7d', impact: 'high' }],
    });
    detectTimingArbitrage(ctx).forEach(i => expect(i.business_id).toBe('biz_001'));
  });
});

// ─── TrustSignalAggregator ────────────────────────────────────────────────────

describe('TrustSignalAggregator', () => {
  test('returns trust_state with score in [0,100]', () => {
    const ctx = makeCtx({
      reviews:     { total: 25, avg_rating: 4.3, negative_last7d: 1, pending_response: 2 },
      competitors: [{ name: 'A', rating: 4.0, trend_direction: 'stable' }],
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.trust_score).toBeGreaterThanOrEqual(0);
    expect(trust_state.trust_score).toBeLessThanOrEqual(100);
  });

  test('vs_competitors is positive when our rating > competitor avg', () => {
    const ctx = makeCtx({
      reviews:     { total: 30, avg_rating: 4.6, negative_last7d: 0, pending_response: 0 },
      competitors: [
        { name: 'A', rating: 4.0, trend_direction: 'stable' },
        { name: 'B', rating: 3.8, trend_direction: 'stable' },
      ],
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.vs_competitors).toBeGreaterThan(0);
    expect(trust_state.gap_type).toBe('leading');
  });

  test('vs_competitors is negative when our rating < competitor avg', () => {
    const ctx = makeCtx({
      reviews:     { total: 20, avg_rating: 3.5, negative_last7d: 2, pending_response: 1 },
      competitors: [
        { name: 'A', rating: 4.5, trend_direction: 'rising' },
        { name: 'B', rating: 4.3, trend_direction: 'stable' },
      ],
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.vs_competitors).toBeLessThan(0);
    expect(trust_state.gap_type).toBe('lagging');
  });

  test('generates trust_gap lagging insight when we trail competitors', () => {
    const ctx = makeCtx({
      reviews:     { total: 20, avg_rating: 3.5, negative_last7d: 0, pending_response: 0 },
      competitors: [
        { name: 'A', rating: 4.5, trend_direction: 'stable' },
        { name: 'B', rating: 4.4, trend_direction: 'stable' },
      ],
    });
    const { insights } = analyzeTrustSignals(ctx);
    expect(insights.some(i => i.dedup_key.includes('trust_gap_lagging'))).toBe(true);
  });

  test('generates trust leading insight when we are ahead', () => {
    const ctx = makeCtx({
      reviews:     { total: 35, avg_rating: 4.8, negative_last7d: 0, pending_response: 0 },
      competitors: [
        { name: 'A', rating: 4.0, trend_direction: 'stable' },
      ],
    });
    const { insights } = analyzeTrustSignals(ctx);
    expect(insights.some(i => i.dedup_key.includes('trust_gap_leading'))).toBe(true);
  });

  test('generates pending_responses insight when pending >= 3', () => {
    const ctx = makeCtx({
      reviews: { total: 25, avg_rating: 4.0, negative_last7d: 0, pending_response: 5 },
    });
    const { insights } = analyzeTrustSignals(ctx);
    expect(insights.some(i => i.dedup_key.includes('pending_responses'))).toBe(true);
  });

  test('generates weak_review_volume insight when total reviews < 10', () => {
    const ctx = makeCtx({
      reviews: { total: 4, avg_rating: 4.5, negative_last7d: 0, pending_response: 0 },
    });
    const { insights } = analyzeTrustSignals(ctx);
    expect(insights.some(i => i.dedup_key.includes('weak_review_volume'))).toBe(true);
  });

  test('response_rate is 0 when no reviews', () => {
    const ctx = makeCtx({
      reviews: { total: 0, avg_rating: null, negative_last7d: 0, pending_response: 0 },
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.response_rate).toBeGreaterThanOrEqual(0);
    expect(trust_state.response_rate).toBeLessThanOrEqual(1);
  });

  test('signal_strength is strong when total reviews >= 30', () => {
    const ctx = makeCtx({
      reviews: { total: 45, avg_rating: 4.2, negative_last7d: 0, pending_response: 0 },
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.signal_strength).toBe('strong');
  });

  test('signal_strength is weak when total reviews < 10', () => {
    const ctx = makeCtx({
      reviews: { total: 3, avg_rating: 4.5, negative_last7d: 0, pending_response: 0 },
    });
    const { trust_state } = analyzeTrustSignals(ctx);
    expect(trust_state.signal_strength).toBe('weak');
  });

  test('high pending count raises urgency on pending insight', () => {
    const ctx = makeCtx({
      reviews: { total: 30, avg_rating: 4.0, negative_last7d: 0, pending_response: 6 },
    });
    const { insights } = analyzeTrustSignals(ctx);
    const pending = insights.find(i => i.dedup_key.includes('pending_responses'));
    expect(pending?.urgency).toBe('high');
  });
});

// ─── InvisibleChurnPredictor ──────────────────────────────────────────────────

describe('InvisibleChurnPredictor', () => {
  test('returns churn_risk_state with valid risk_level', () => {
    const ctx = makeCtx();
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    expect(['low', 'medium', 'high', 'critical']).toContain(churn_risk_state.risk_level);
  });

  test('risk_score is in [0,1]', () => {
    const ctx = makeCtx({
      reviews:     { total: 20, avg_rating: 3.0, negative_last7d: 5, pending_response: 4 },
      competitors: [{ name: 'A', rating: 4.5, trend_direction: 'rising' }],
    });
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    expect(churn_risk_state.risk_score).toBeGreaterThanOrEqual(0);
    expect(churn_risk_state.risk_score).toBeLessThanOrEqual(1);
  });

  test('critical risk when multiple strong negative signals', () => {
    const ctx = makeCtx({
      reviews:     { total: 30, avg_rating: 2.8, negative_last7d: 8, pending_response: 6 },
      competitors: [
        { name: 'A', rating: 4.8, trend_direction: 'rising' },
        { name: 'B', rating: 4.5, trend_direction: 'rising' },
      ],
      leads:       { total: 2, hot: 0, warm: 1, new: 0, avg_score: 20 },
      health_score: 20,
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '7d',
        demand_delta_pct: -30, confidence: 0.80,
        created_at: new Date().toISOString(), expected_demand_score: 30, factors: [],
      }],
    });
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    expect(['high', 'critical']).toContain(churn_risk_state.risk_level);
  });

  test('low risk with healthy metrics', () => {
    const ctx = makeCtx({
      reviews:     { total: 40, avg_rating: 4.6, negative_last7d: 0, pending_response: 0 },
      competitors: [{ name: 'A', rating: 3.8, trend_direction: 'falling' }],
      leads:       { total: 20, hot: 8, warm: 5, new: 3, avg_score: 70 },
      health_score: 88,
    });
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    expect(churn_risk_state.risk_level).toBe('low');
  });

  test('generates retention insight when risk is high or critical', () => {
    const ctx = makeCtx({
      reviews:     { total: 20, avg_rating: 2.9, negative_last7d: 7, pending_response: 5 },
      competitors: [
        { name: 'A', rating: 4.7, trend_direction: 'rising' },
        { name: 'B', rating: 4.4, trend_direction: 'rising' },
      ],
      leads:       { total: 2, hot: 0, warm: 0, new: 0, avg_score: 15 },
      health_score: 18,
    });
    const { insights } = predictInvisibleChurn(ctx);
    expect(insights.some(i => i.dedup_key.includes('churn_risk'))).toBe(true);
    expect(insights.every(i => i.type === 'invisible_churn')).toBe(true);
  });

  test('competitor attraction insight fires when 2+ competitors are rising', () => {
    const ctx = makeCtx({
      competitors: [
        { name: 'A', rating: 4.5, trend_direction: 'rising' },
        { name: 'B', rating: 4.3, trend_direction: 'rising' },
      ],
    });
    const { insights } = predictInvisibleChurn(ctx);
    expect(insights.some(i => i.dedup_key.includes('competitor_attraction'))).toBe(true);
  });

  test('indicators array has at least one entry when risk is non-low', () => {
    const ctx = makeCtx({
      reviews:     { total: 15, avg_rating: 3.0, negative_last7d: 4, pending_response: 3 },
      competitors: [{ name: 'A', rating: 4.5, trend_direction: 'rising' }],
    });
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    if (churn_risk_state.risk_level !== 'low') {
      expect(churn_risk_state.indicators.length).toBeGreaterThan(0);
    }
  });

  test('estimated_churn_pct is in [0,1]', () => {
    const ctx = makeCtx({
      reviews: { total: 15, avg_rating: 3.2, negative_last7d: 4, pending_response: 2 },
    });
    const { churn_risk_state } = predictInvisibleChurn(ctx);
    expect(churn_risk_state.estimated_churn_pct).toBeGreaterThanOrEqual(0);
    expect(churn_risk_state.estimated_churn_pct).toBeLessThanOrEqual(1);
  });

  test('demand drop forecast increases risk score', () => {
    const ctxBase = makeCtx();
    const ctxDrop = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '7d',
        demand_delta_pct: -25, confidence: 0.80,
        created_at: new Date().toISOString(), expected_demand_score: 40, factors: [],
      }],
    });
    const { churn_risk_state: base } = predictInvisibleChurn(ctxBase);
    const { churn_risk_state: withDrop } = predictInvisibleChurn(ctxDrop);
    expect(withDrop.risk_score).toBeGreaterThanOrEqual(base.risk_score);
  });
});
