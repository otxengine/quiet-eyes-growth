/**
 * Unit tests — MarketIntelligenceService (Intelligence Layer Facade)
 *
 * Covers:
 * - All 8 engines run and are included in engines_run
 * - Insights aggregated from all engines
 * - Deduplication by dedup_key (first-wins)
 * - Sorting by urgency × confidence × business_fit (descending)
 * - insight.generated emitted for each insight
 * - trust.analyzed emitted always
 * - churn.risk.detected emitted only when risk_level !== 'low'
 * - market.intelligence.complete emitted at end
 * - Engine failure isolation (one engine throws → others still succeed)
 * - trust_state and churn_risk_state returned correctly
 * - Filter helpers: getTopInsightsByCategory, getUrgentInsights, extractActionTypes
 */

// ─── Mocks (must come before imports) ────────────────────────────────────────

jest.mock('../events/EventBus', () => ({
  bus: {
    emit:      jest.fn().mockResolvedValue(undefined),
    makeEvent: jest.fn((type: string, entityId: string, payload: unknown, traceId?: string) => ({
      event_id:  'evt_test',
      type,
      entity_id: entityId,
      payload,
      timestamp: new Date().toISOString(),
      trace_id:  traceId ?? '',
      version:   1,
    })),
  },
}));

// Mock all 8 engines
jest.mock('../services/intelligence/engines/SupplyDemandMismatchDetector');
jest.mock('../services/intelligence/engines/WhiteSpaceRadar');
jest.mock('../services/intelligence/engines/GhostDemandCartographer');
jest.mock('../services/intelligence/engines/PriceVacuumDetector');
jest.mock('../services/intelligence/engines/WorkforcePatternOpportunity');
jest.mock('../services/intelligence/engines/TimingArbitrageEngine');
jest.mock('../services/intelligence/engines/TrustSignalAggregator');
jest.mock('../services/intelligence/engines/InvisibleChurnPredictor');

import { runMarketIntelligence, getTopInsightsByCategory, getUrgentInsights, extractActionTypes } from '../services/intelligence/MarketIntelligenceService';
import { detectSupplyDemandMismatches } from '../services/intelligence/engines/SupplyDemandMismatchDetector';
import { detectWhiteSpaces }            from '../services/intelligence/engines/WhiteSpaceRadar';
import { detectGhostDemand }            from '../services/intelligence/engines/GhostDemandCartographer';
import { detectPriceVacuums }           from '../services/intelligence/engines/PriceVacuumDetector';
import { detectWorkforcePatterns }      from '../services/intelligence/engines/WorkforcePatternOpportunity';
import { detectTimingArbitrage }        from '../services/intelligence/engines/TimingArbitrageEngine';
import { analyzeTrustSignals }          from '../services/intelligence/engines/TrustSignalAggregator';
import { predictInvisibleChurn }        from '../services/intelligence/engines/InvisibleChurnPredictor';
import { bus }                          from '../events/EventBus';
import type { EnrichedContext, Insight, TrustState, ChurnRiskState } from '../models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    context_id:    'ctx_001',
    business_id:   'biz_001',
    built_at:      new Date().toISOString(),
    trace_id:      'trace_test',
    profile:       { name: 'Test Biz', category: 'food', city: 'Tel Aviv', plan_id: null },
    meta_configuration: null,
    recent_signals:     [],
    signals:  { total: 5, high_urgency: 1, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:    { total: 10, hot: 2, warm: 3, new: 1, avg_score: 50 },
    health_score:  65,
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

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id:                     'ins_001',
    engine:                 'TestEngine',
    type:                   'supply_demand_mismatch' as any,
    category:               'opportunity',
    title:                  'Test Insight',
    summary:                'Test summary',
    supporting_signals:     [],
    confidence:             0.8,
    urgency:                'high',
    business_fit:           0.75,
    timeframe:              '7d',
    estimated_impact:       'high',
    recommended_action_types: ['outreach'],
    metadata:               {},
    dedup_key:              'test-dedup-key',
    business_id:            'biz_001',
    created_at:             new Date().toISOString(),
    ...overrides,
  };
}

function makeTrustState(overrides: Partial<TrustState> = {}): TrustState {
  return {
    trust_score:     70,
    vs_competitors:  0.1,
    review_velocity: 2.5,
    response_rate:   0.85,
    signal_strength: 'strong',
    gap_type:        'leading',
    recommendations: [],
    ...overrides,
  };
}

function makeChurnState(overrides: Partial<ChurnRiskState> = {}): ChurnRiskState {
  return {
    risk_level:          'low',
    risk_score:          0.1,
    indicators:          [],
    estimated_churn_pct: 5,
    top_risk_factor:     'none',
    window_days:         30,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function setupMocks(
  insightsByEngine: Partial<Record<string, Insight[]>> = {},
  trustState?: TrustState,
  churnState?: ChurnRiskState,
) {
  (detectSupplyDemandMismatches as jest.Mock).mockReturnValue(insightsByEngine.sdd ?? []);
  (detectWhiteSpaces as jest.Mock).mockReturnValue(insightsByEngine.ws ?? []);
  (detectGhostDemand as jest.Mock).mockReturnValue(insightsByEngine.gd ?? []);
  (detectPriceVacuums as jest.Mock).mockReturnValue(insightsByEngine.pv ?? []);
  (detectWorkforcePatterns as jest.Mock).mockReturnValue(insightsByEngine.wp ?? []);
  (detectTimingArbitrage as jest.Mock).mockReturnValue(insightsByEngine.ta ?? []);
  (analyzeTrustSignals as jest.Mock).mockReturnValue({
    trust_state: trustState ?? makeTrustState(),
    insights:    insightsByEngine.trust ?? [],
  });
  (predictInvisibleChurn as jest.Mock).mockReturnValue({
    churn_risk_state: churnState ?? makeChurnState(),
    insights:         insightsByEngine.churn ?? [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupMocks();
});

// ─── Engine orchestration ─────────────────────────────────────────────────────

describe('MarketIntelligenceService — engine orchestration', () => {
  test('all 8 engines are called', async () => {
    const ctx = makeCtx();
    await runMarketIntelligence(ctx, 'trace_01');

    expect(detectSupplyDemandMismatches).toHaveBeenCalledWith(ctx);
    expect(detectWhiteSpaces).toHaveBeenCalledWith(ctx);
    expect(detectGhostDemand).toHaveBeenCalledWith(ctx);
    expect(detectPriceVacuums).toHaveBeenCalledWith(ctx);
    expect(detectWorkforcePatterns).toHaveBeenCalledWith(ctx);
    expect(detectTimingArbitrage).toHaveBeenCalledWith(ctx);
    expect(analyzeTrustSignals).toHaveBeenCalledWith(ctx);
    expect(predictInvisibleChurn).toHaveBeenCalledWith(ctx);
  });

  test('engines_run includes all 8 engine names when all succeed', async () => {
    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.engines_run).toHaveLength(8);
    expect(result.engines_run).toContain('SupplyDemandMismatchDetector');
    expect(result.engines_run).toContain('WhiteSpaceRadar');
    expect(result.engines_run).toContain('GhostDemandCartographer');
    expect(result.engines_run).toContain('PriceVacuumDetector');
    expect(result.engines_run).toContain('WorkforcePatternOpportunity');
    expect(result.engines_run).toContain('TimingArbitrageEngine');
    expect(result.engines_run).toContain('TrustSignalAggregator');
    expect(result.engines_run).toContain('InvisibleChurnPredictor');
  });

  test('insights from all engines are aggregated', async () => {
    setupMocks({
      sdd:   [makeInsight({ id: 'i1', dedup_key: 'k1', engine: 'SupplyDemandMismatchDetector' })],
      ws:    [makeInsight({ id: 'i2', dedup_key: 'k2', engine: 'WhiteSpaceRadar' })],
      trust: [makeInsight({ id: 'i3', dedup_key: 'k3', engine: 'TrustSignalAggregator' })],
      churn: [makeInsight({ id: 'i4', dedup_key: 'k4', engine: 'InvisibleChurnPredictor' })],
    });

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights).toHaveLength(4);
  });

  test('duration_ms is a non-negative number', async () => {
    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration_ms).toBe('number');
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe('MarketIntelligenceService — deduplication', () => {
  test('duplicate dedup_keys from different engines: first insight wins', async () => {
    const first  = makeInsight({ id: 'i1', dedup_key: 'same-key', engine: 'SupplyDemandMismatchDetector', title: 'First' });
    const second = makeInsight({ id: 'i2', dedup_key: 'same-key', engine: 'WhiteSpaceRadar',              title: 'Second' });

    setupMocks({ sdd: [first], ws: [second] });

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    const sameKey = result.insights.filter(i => i.dedup_key === 'same-key');
    expect(sameKey).toHaveLength(1);
    expect(sameKey[0].id).toBe('i1'); // first-wins
  });

  test('unique dedup_keys are all kept', async () => {
    setupMocks({
      sdd: [
        makeInsight({ id: 'i1', dedup_key: 'k1' }),
        makeInsight({ id: 'i2', dedup_key: 'k2' }),
        makeInsight({ id: 'i3', dedup_key: 'k3' }),
      ],
    });

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights).toHaveLength(3);
  });

  test('all duplicates from same engine are collapsed correctly', async () => {
    setupMocks({
      sdd: [
        makeInsight({ id: 'a', dedup_key: 'dup' }),
        makeInsight({ id: 'b', dedup_key: 'dup' }),
        makeInsight({ id: 'c', dedup_key: 'dup' }),
      ],
    });

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights.filter(i => i.dedup_key === 'dup')).toHaveLength(1);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe('MarketIntelligenceService — sorting', () => {
  test('insights sorted by urgency × confidence × business_fit descending', async () => {
    const low  = makeInsight({ id: 'low',  dedup_key: 'k_low',  urgency: 'low',      confidence: 0.5, business_fit: 0.5 });
    const high = makeInsight({ id: 'high', dedup_key: 'k_high', urgency: 'critical', confidence: 0.9, business_fit: 0.9 });
    const mid  = makeInsight({ id: 'mid',  dedup_key: 'k_mid',  urgency: 'medium',   confidence: 0.7, business_fit: 0.7 });

    setupMocks({ sdd: [low, high, mid] });

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights[0].id).toBe('high');
    expect(result.insights[result.insights.length - 1].id).toBe('low');
  });

  test('critical urgency ranks above high urgency with equal confidence', async () => {
    const crit = makeInsight({ id: 'c', dedup_key: 'k_c', urgency: 'critical', confidence: 0.8, business_fit: 0.8 });
    const hi   = makeInsight({ id: 'h', dedup_key: 'k_h', urgency: 'high',     confidence: 0.8, business_fit: 0.8 });

    setupMocks({ sdd: [hi, crit] }); // hi first, crit should bubble up

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights[0].id).toBe('c');
  });
});

// ─── Event emission ───────────────────────────────────────────────────────────

describe('MarketIntelligenceService — event emission', () => {
  test('emits insight.generated for each deduplicated insight', async () => {
    setupMocks({
      sdd: [makeInsight({ id: 'i1', dedup_key: 'k1' })],
      ws:  [makeInsight({ id: 'i2', dedup_key: 'k2' })],
    });

    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    const insightGenerated = calls.filter(c => c[0] === 'insight.generated');
    expect(insightGenerated).toHaveLength(2);
  });

  test('emits trust.analyzed always', async () => {
    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'trust.analyzed')).toBe(true);
  });

  test('emits churn.risk.detected when risk_level is high', async () => {
    setupMocks({}, undefined, makeChurnState({ risk_level: 'high', risk_score: 0.7 }));

    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'churn.risk.detected')).toBe(true);
  });

  test('does NOT emit churn.risk.detected when risk_level is low', async () => {
    setupMocks({}, undefined, makeChurnState({ risk_level: 'low' }));

    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'churn.risk.detected')).toBe(false);
  });

  test('emits market.intelligence.complete at the end', async () => {
    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'market.intelligence.complete')).toBe(true);
  });

  test('market.intelligence.complete payload includes correct fields', async () => {
    setupMocks({
      sdd: [makeInsight({ id: 'i1', dedup_key: 'k1' })],
    });

    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    const completedCall = calls.find(c => c[0] === 'market.intelligence.complete');
    expect(completedCall).toBeDefined();
    const payload = completedCall[2] as any;
    expect(payload.insights_count).toBe(1);
    expect(Array.isArray(payload.engines_run)).toBe(true);
    expect(typeof payload.duration_ms).toBe('number');
  });

  test('insight.generated not emitted when no insights produced', async () => {
    // All engines return []
    setupMocks({});

    await runMarketIntelligence(makeCtx(), 'trace_01');

    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    const insightGenerated = calls.filter(c => c[0] === 'insight.generated');
    expect(insightGenerated).toHaveLength(0);
  });
});

// ─── Trust & Churn state ──────────────────────────────────────────────────────

describe('MarketIntelligenceService — trust & churn state', () => {
  test('returns trust_state from TrustSignalAggregator', async () => {
    const trust = makeTrustState({ trust_score: 85, gap_type: 'leading' });
    setupMocks({}, trust);

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.trust_state.trust_score).toBe(85);
    expect(result.trust_state.gap_type).toBe('leading');
  });

  test('returns churn_risk_state from InvisibleChurnPredictor', async () => {
    const churn = makeChurnState({ risk_level: 'critical', risk_score: 0.9 });
    setupMocks({}, undefined, churn);

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.churn_risk_state.risk_level).toBe('critical');
    expect(result.churn_risk_state.risk_score).toBe(0.9);
  });

  test('falls back to default trust_state when TrustSignalAggregator returns rejected promise', async () => {
    (analyzeTrustSignals as jest.Mock).mockImplementation(() => Promise.reject(new Error('trust engine exploded')));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    // Default trust state
    expect(result.trust_state.trust_score).toBe(50);
    expect(result.trust_state.gap_type).toBe('on_par');
  });

  test('falls back to default churn_state when InvisibleChurnPredictor returns rejected promise', async () => {
    (predictInvisibleChurn as jest.Mock).mockImplementation(() => Promise.reject(new Error('churn engine exploded')));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.churn_risk_state.risk_level).toBe('low');
    expect(result.churn_risk_state.risk_score).toBe(0);
  });
});

// ─── Engine failure isolation ─────────────────────────────────────────────────

describe('MarketIntelligenceService — failure isolation', () => {
  test('one engine returning rejected promise does not prevent others from running', async () => {
    setupMocks({
      sdd: [makeInsight({ id: 'i1', dedup_key: 'k1', engine: 'SupplyDemandMismatchDetector' })],
    });
    // Override ws with rejected promise AFTER setupMocks (so it isn't reset)
    (detectWhiteSpaces as jest.Mock).mockImplementation(() => Promise.reject(new Error('WhiteSpace exploded')));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights.some(i => i.id === 'i1')).toBe(true);
  });

  test('failed engine is excluded from engines_run', async () => {
    (detectGhostDemand as jest.Mock).mockImplementation(() => Promise.reject(new Error('ghost exploded')));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.engines_run).not.toContain('GhostDemandCartographer');
  });

  test('multiple engine failures still return remaining insights', async () => {
    setupMocks({
      sdd: [makeInsight({ id: 'i_sdd', dedup_key: 'k_sdd' })],
    });
    (detectWhiteSpaces as jest.Mock).mockImplementation(() => Promise.reject(new Error('ws fail')));
    (detectGhostDemand as jest.Mock).mockImplementation(() => Promise.reject(new Error('gd fail')));
    (detectPriceVacuums as jest.Mock).mockImplementation(() => Promise.reject(new Error('pv fail')));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights.some(i => i.id === 'i_sdd')).toBe(true);
    expect(result.engines_run).not.toContain('WhiteSpaceRadar');
    expect(result.engines_run).not.toContain('GhostDemandCartographer');
    expect(result.engines_run).not.toContain('PriceVacuumDetector');
  });

  test('all engines failing returns empty insights with default states', async () => {
    [
      detectSupplyDemandMismatches, detectWhiteSpaces, detectGhostDemand,
      detectPriceVacuums, detectWorkforcePatterns, detectTimingArbitrage,
      analyzeTrustSignals, predictInvisibleChurn,
    ].forEach(fn => (fn as jest.Mock).mockImplementation(() => Promise.reject(new Error('fail'))));

    const result = await runMarketIntelligence(makeCtx(), 'trace_01');
    expect(result.insights).toHaveLength(0);
    expect(result.engines_run).toHaveLength(0);
    expect(result.trust_state.trust_score).toBe(50);
    expect(result.churn_risk_state.risk_level).toBe('low');
  });
});

// ─── Filter helpers ────────────────────────────────────────────────────────────

describe('getTopInsightsByCategory', () => {
  const insights: Insight[] = [
    makeInsight({ id: 'a', dedup_key: 'ka', category: 'opportunity', urgency: 'high',     confidence: 0.9, business_fit: 0.9 }),
    makeInsight({ id: 'b', dedup_key: 'kb', category: 'opportunity', urgency: 'medium',   confidence: 0.7, business_fit: 0.7 }),
    makeInsight({ id: 'c', dedup_key: 'kc', category: 'opportunity', urgency: 'low',      confidence: 0.5, business_fit: 0.5 }),
    makeInsight({ id: 'd', dedup_key: 'kd', category: 'threat',      urgency: 'critical', confidence: 0.9, business_fit: 0.9 }),
  ];

  test('filters by category', () => {
    const result = getTopInsightsByCategory(insights, 'threat');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d');
  });

  test('limits results to default 3', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeInsight({ id: `x${i}`, dedup_key: `kx${i}`, category: 'opportunity' })
    );
    const result = getTopInsightsByCategory(many, 'opportunity');
    expect(result).toHaveLength(3);
  });

  test('respects custom limit', () => {
    const result = getTopInsightsByCategory(insights, 'opportunity', 2);
    expect(result).toHaveLength(2);
  });

  test('returns top by priority (highest urgency × confidence first)', () => {
    const result = getTopInsightsByCategory(insights, 'opportunity', 3);
    expect(result[0].id).toBe('a'); // high urgency, high confidence
    expect(result[result.length - 1].id).toBe('c'); // low urgency
  });

  test('returns empty for unknown category', () => {
    const result = getTopInsightsByCategory(insights, 'retention' as any);
    expect(result).toHaveLength(0);
  });
});

describe('getUrgentInsights', () => {
  const mixed: Insight[] = [
    makeInsight({ id: '1', dedup_key: 'k1', urgency: 'critical' }),
    makeInsight({ id: '2', dedup_key: 'k2', urgency: 'high' }),
    makeInsight({ id: '3', dedup_key: 'k3', urgency: 'medium' }),
    makeInsight({ id: '4', dedup_key: 'k4', urgency: 'low' }),
  ];

  test('returns only critical and high urgency insights', () => {
    const result = getUrgentInsights(mixed);
    expect(result).toHaveLength(2);
    expect(result.every(i => i.urgency === 'critical' || i.urgency === 'high')).toBe(true);
  });

  test('returns empty when no urgent insights', () => {
    const low = [
      makeInsight({ id: 'a', dedup_key: 'ka', urgency: 'low' }),
      makeInsight({ id: 'b', dedup_key: 'kb', urgency: 'medium' }),
    ];
    expect(getUrgentInsights(low)).toHaveLength(0);
  });

  test('returns all when all are critical', () => {
    const all = [
      makeInsight({ id: 'x', dedup_key: 'kx', urgency: 'critical' }),
      makeInsight({ id: 'y', dedup_key: 'ky', urgency: 'critical' }),
    ];
    expect(getUrgentInsights(all)).toHaveLength(2);
  });
});

describe('extractActionTypes', () => {
  test('returns unique action types across all insights', () => {
    const insights: Insight[] = [
      makeInsight({ id: 'a', dedup_key: 'ka', recommended_action_types: ['outreach', 'content'] }),
      makeInsight({ id: 'b', dedup_key: 'kb', recommended_action_types: ['content', 'pricing'] }),
      makeInsight({ id: 'c', dedup_key: 'kc', recommended_action_types: ['outreach'] }),
    ];
    const result = extractActionTypes(insights);
    expect(result).toHaveLength(3);
    expect(result).toContain('outreach');
    expect(result).toContain('content');
    expect(result).toContain('pricing');
  });

  test('returns empty for empty insights', () => {
    expect(extractActionTypes([])).toHaveLength(0);
  });

  test('returns empty for insights with no action types', () => {
    const ins = [makeInsight({ id: 'a', dedup_key: 'ka', recommended_action_types: [] })];
    expect(extractActionTypes(ins)).toHaveLength(0);
  });

  test('deduplicates within single insight', () => {
    const ins = [makeInsight({ id: 'a', dedup_key: 'ka', recommended_action_types: ['outreach', 'outreach', 'content'] })];
    const result = extractActionTypes(ins);
    expect(result.filter(t => t === 'outreach')).toHaveLength(1);
  });
});
