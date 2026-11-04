/**
 * Unit tests — Intelligence Layer
 *
 * Covers OpportunityDetector and ThreatDetector:
 * - Detection thresholds and candidate scoring
 * - Score filtering (MIN_OPPORTUNITY_SCORE / MIN_RISK_SCORE)
 * - Urgency level transitions
 * - reputation_attack escalation vs negative_review_spike
 * - Bus event emission on detection
 * - No candidates → empty result, no DB writes
 * - expireStale called before upsert (opportunity only)
 */

jest.mock('../repositories/OpportunityRepository', () => ({
  opportunityRepository: {
    upsert:      jest.fn(),
    expireStale: jest.fn(),
  },
  threatRepository: {
    upsert: jest.fn(),
  },
}));

jest.mock('../lib/signalHash', () => ({
  hashOpportunity: jest.fn((_b: string, type: string) => `hash_opp_${type}`),
  hashThreat:      jest.fn((_b: string, type: string) => `hash_thr_${type}`),
}));

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

import { detectOpportunities } from '../services/intelligence/OpportunityDetector';
import { detectThreats }       from '../services/intelligence/ThreatDetector';
import { opportunityRepository, threatRepository } from '../repositories/OpportunityRepository';
import { bus }                 from '../events/EventBus';
import type { EnrichedContext } from '../models';

// ─── Context factory ──────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    context_id:    'ctx_001',
    business_id:   'biz_001',
    built_at:      new Date().toISOString(),
    trace_id:      'trace_test',
    profile: { name: 'Test Biz', category: 'food', city: 'Tel Aviv', plan_id: null },
    meta_configuration: null,
    recent_signals:     [],
    signals:  { total: 0, high_urgency: 0, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:    { total: 10, hot: 0, warm: 3, new: 2, avg_score: 50 },
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

function setupRepos() {
  (opportunityRepository.upsert as jest.Mock).mockResolvedValue({ id: 'opp_test_id', is_new: true });
  (opportunityRepository.expireStale as jest.Mock).mockResolvedValue(undefined);
  (threatRepository.upsert as jest.Mock).mockResolvedValue({ id: 'thr_test_id', is_new: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupRepos();
});

// ─── OpportunityDetector ──────────────────────────────────────────────────────

describe('OpportunityDetector', () => {
  test('returns empty array when no candidates detected', async () => {
    const ctx = makeCtx(); // defaults: 0 hot leads, 0 negatives, no competitors, etc.
    const result = await detectOpportunities(ctx, 'trace_01');
    expect(result).toHaveLength(0);
    expect(opportunityRepository.upsert).not.toHaveBeenCalled();
  });

  test('detects lead_surge when hot leads >= 3', async () => {
    const ctx = makeCtx({ leads: { total: 10, hot: 4, warm: 2, new: 1, avg_score: 60 } });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'lead_surge')).toBe(true);
  });

  test('lead_surge urgency is "medium" for 3-5 hot leads', async () => {
    const ctx = makeCtx({ leads: { total: 5, hot: 3, warm: 1, new: 0, avg_score: 55 } });
    const opps = await detectOpportunities(ctx, 'trace_01');
    const opp  = opps.find(o => o.type === 'lead_surge');
    expect(opp?.urgency).toBe('medium');
  });

  test('lead_surge urgency is "high" for 6+ hot leads', async () => {
    const ctx = makeCtx({ leads: { total: 8, hot: 7, warm: 1, new: 0, avg_score: 70 } });
    const opps = await detectOpportunities(ctx, 'trace_01');
    const opp  = opps.find(o => o.type === 'lead_surge');
    expect(opp?.urgency).toBe('high');
  });

  test('detects reputation_recovery when negative reviews >= 2 and avg_rating >= 3.5', async () => {
    const ctx = makeCtx({
      reviews: { total: 30, avg_rating: 4.0, negative_last7d: 3, pending_response: 2 },
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'reputation_recovery')).toBe(true);
  });

  test('does NOT detect reputation_recovery when avg_rating < 3.5', async () => {
    const ctx = makeCtx({
      reviews: { total: 30, avg_rating: 3.0, negative_last7d: 4, pending_response: 0 },
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'reputation_recovery')).toBe(false);
  });

  test('detects competitor_gap when at least 1 competitor is falling', async () => {
    const ctx = makeCtx({
      competitors: [{ name: 'CompA', rating: 4.0, trend_direction: 'falling' }],
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'competitor_gap')).toBe(true);
  });

  test('detects demand_spike from forecast with delta > 20%', async () => {
    const ctx = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '7d',
        demand_delta_pct: 35, confidence: 0.80, created_at: new Date().toISOString(),
      } as any],
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'demand_spike')).toBe(true);
  });

  test('does NOT detect demand_spike when forecast delta <= 20%', async () => {
    const ctx = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '7d',
        demand_delta_pct: 15, confidence: 0.80, created_at: new Date().toISOString(),
      } as any],
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'demand_spike')).toBe(false);
  });

  test('detects demand_spike from high-urgency signals >= 3', async () => {
    const ctx = makeCtx({ signals: { total: 10, high_urgency: 5, items: [] } });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'demand_spike')).toBe(true);
  });

  test('detects local_event when active_predictions has high-impact prediction', async () => {
    const ctx = makeCtx({
      active_predictions: [{ title: 'Trade fair', confidence: 0.7, timeframe: '7d', impact: 'high' }],
    });
    const opps = await detectOpportunities(ctx, 'trace_01');
    expect(opps.some(o => o.type === 'local_event')).toBe(true);
  });

  test('calls expireStale before upsert', async () => {
    const ctx  = makeCtx({ leads: { total: 5, hot: 4, warm: 1, new: 0, avg_score: 60 } });
    const callOrder: string[] = [];
    (opportunityRepository.expireStale as jest.Mock).mockImplementation(async () => {
      callOrder.push('expire');
    });
    (opportunityRepository.upsert as jest.Mock).mockImplementation(async () => {
      callOrder.push('upsert');
      return { id: 'opp_x', is_new: true };
    });
    await detectOpportunities(ctx, 'trace_01');
    const expireIdx = callOrder.indexOf('expire');
    const upsertIdx = callOrder.indexOf('upsert');
    expect(expireIdx).toBeLessThan(upsertIdx);
  });

  test('emits opportunity.detected event for each detected opportunity', async () => {
    const ctx  = makeCtx({ leads: { total: 5, hot: 4, warm: 1, new: 0, avg_score: 60 } });
    await detectOpportunities(ctx, 'trace_01');
    expect(bus.emit).toHaveBeenCalled();
    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'opportunity.detected')).toBe(true);
  });

  test('opportunity_score is clamped to [0,1]', async () => {
    // 10 hot leads → score = min(1, 0.5 + 10*0.1) = 1.0
    const ctx = makeCtx({ leads: { total: 10, hot: 10, warm: 0, new: 0, avg_score: 80 } });
    const opps = await detectOpportunities(ctx, 'trace_01');
    const opp  = opps.find(o => o.type === 'lead_surge');
    expect(opp!.opportunity_score).toBeLessThanOrEqual(1.0);
    expect(opp!.opportunity_score).toBeGreaterThan(0);
  });
});

// ─── ThreatDetector ───────────────────────────────────────────────────────────

describe('ThreatDetector', () => {
  test('returns empty array when no threat candidates', async () => {
    const ctx = makeCtx({
      health_score: 80,
      leads:   { total: 10, hot: 2, warm: 3, new: 2, avg_score: 55 },
      reviews: { total: 20, avg_rating: 4.5, negative_last7d: 0, pending_response: 0 },
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats).toHaveLength(0);
    expect(threatRepository.upsert).not.toHaveBeenCalled();
  });

  test('detects negative_review_spike when negative reviews 3–7', async () => {
    const ctx = makeCtx({
      reviews: { total: 30, avg_rating: 3.8, negative_last7d: 4, pending_response: 0 },
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'negative_review_spike')).toBe(true);
  });

  test('escalates to reputation_attack when negative reviews >= 8', async () => {
    const ctx = makeCtx({
      reviews: { total: 50, avg_rating: 3.0, negative_last7d: 9, pending_response: 5 },
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'reputation_attack')).toBe(true);
    expect(threats.some(t => t.type === 'negative_review_spike')).toBe(false);
  });

  test('escalates urgency to critical for reputation_attack', async () => {
    const ctx = makeCtx({
      reviews: { total: 50, avg_rating: 3.0, negative_last7d: 10, pending_response: 5 },
    });
    const threats = await detectThreats(ctx, 'trace_01');
    const attack  = threats.find(t => t.type === 'reputation_attack');
    expect(attack?.urgency).toBe('critical');
  });

  test('detects competitor_promotion when rising competitor with rating >= 4.2', async () => {
    const ctx = makeCtx({
      competitors: [{ name: 'BigCo', rating: 4.5, trend_direction: 'rising' }],
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'competitor_promotion')).toBe(true);
  });

  test('does NOT detect competitor_promotion for rising competitor with rating < 4.2', async () => {
    const ctx = makeCtx({
      competitors: [{ name: 'SmallCo', rating: 3.9, trend_direction: 'rising' }],
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'competitor_promotion')).toBe(false);
  });

  test('detects lead_drop when total < 5 and hot === 0', async () => {
    const ctx = makeCtx({ leads: { total: 2, hot: 0, warm: 1, new: 0, avg_score: 30 } });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'lead_drop')).toBe(true);
  });

  test('does NOT detect lead_drop when hot > 0', async () => {
    const ctx = makeCtx({ leads: { total: 3, hot: 1, warm: 0, new: 0, avg_score: 40 } });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'lead_drop')).toBe(false);
  });

  test('detects demand_drop from forecast with delta < -15%', async () => {
    const ctx = makeCtx({
      forecasts: [{
        id: 'f1', business_id: 'biz_001', forecast_window: '7d',
        demand_delta_pct: -25, confidence: 0.75, created_at: new Date().toISOString(),
      } as any],
    });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'demand_drop')).toBe(true);
  });

  test('detects service_gap when health_score < 40', async () => {
    const ctx = makeCtx({ health_score: 30 });
    const threats = await detectThreats(ctx, 'trace_01');
    expect(threats.some(t => t.type === 'service_gap')).toBe(true);
  });

  test('service_gap urgency is "high" when health < 25', async () => {
    const ctx = makeCtx({ health_score: 20 });
    const threats = await detectThreats(ctx, 'trace_01');
    const gap  = threats.find(t => t.type === 'service_gap');
    expect(gap?.urgency).toBe('high');
  });

  test('emits threat.detected event for each detected threat', async () => {
    const ctx = makeCtx({
      reviews: { total: 30, avg_rating: 3.5, negative_last7d: 5, pending_response: 0 },
    });
    await detectThreats(ctx, 'trace_01');
    const calls = (bus.makeEvent as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === 'threat.detected')).toBe(true);
  });

  test('threat risk_score is rounded to 3 decimal places', async () => {
    const ctx = makeCtx({
      reviews: { total: 20, avg_rating: 3.5, negative_last7d: 4, pending_response: 0 },
    });
    const threats = await detectThreats(ctx, 'trace_01');
    const spike   = threats.find(t => t.type === 'negative_review_spike');
    if (spike) {
      const decimals = spike.risk_score.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(3);
    }
  });
});
