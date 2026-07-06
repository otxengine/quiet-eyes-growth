/**
 * Unit tests — OpportunityDetector (KAN-71 AC5)
 *
 * Verifies:
 * - Empty context (no triggers) → returns [] (MIN_OPPORTUNITY_SCORE = 0.35 guard)
 * - Context with qualifying triggers → opportunity score ≥ 0.35
 * - opportunityRepository.upsert called for each candidate (dedup path)
 * - opportunity.detected event emitted per opportunity
 */

jest.mock('../repositories/OpportunityRepository', () => ({
  opportunityRepository: {
    expireStale: jest.fn().mockResolvedValue(undefined),
    upsert:      jest.fn().mockResolvedValue({ id: 'opp_mocked', is_new: true }),
  },
}));

jest.mock('../events/EventBus', () => ({
  bus: {
    emit:      jest.fn().mockResolvedValue(undefined),
    makeEvent: jest.fn((type: string, entityId: string, payload: unknown) => ({
      event_id: 'evt_test', type, entity_id: entityId, payload, timestamp: new Date().toISOString(), trace_id: '', version: 1,
    })),
  },
}));

jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../lib/signalHash', () => ({
  hashOpportunity: jest.fn((_bizId: string, type: string) => `hash_${type}`),
}));

jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'test_id') }));

import { detectOpportunities } from '../services/intelligence/OpportunityDetector';
import { opportunityRepository } from '../repositories/OpportunityRepository';
import { bus } from '../events/EventBus';
import type { EnrichedContext } from '../models';

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
    signals:  { total: 0, high_urgency: 0, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:    { total: 0, hot: 0, warm: 0, new: 0, avg_score: 0 },
    health_score:  50,
    health_details: {},
    reviews: { total: 0, avg_rating: 4.0, negative_last7d: 0, pending_response: 0 },
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

beforeEach(() => {
  jest.clearAllMocks();
  (opportunityRepository.upsert as jest.Mock).mockResolvedValue({ id: 'opp_mocked', is_new: true });
});

// ─── AC5: MIN_OPPORTUNITY_SCORE = 0.35 filter ────────────────────────────────

describe('OpportunityDetector — MIN_OPPORTUNITY_SCORE filter', () => {
  test('empty context (no triggers) → returns [] without calling upsert', async () => {
    const result = await detectOpportunities(makeCtx(), 'trace_01');
    expect(result).toHaveLength(0);
    expect(opportunityRepository.expireStale).not.toHaveBeenCalled();
    expect(opportunityRepository.upsert).not.toHaveBeenCalled();
  });

  test('lead_surge (hot >= 3) produces opportunity with score >= 0.35', async () => {
    const ctx = makeCtx({ leads: { total: 5, hot: 3, warm: 1, new: 1, avg_score: 60 } });
    const result = await detectOpportunities(ctx, 'trace_02');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(o => o.opportunity_score >= 0.35)).toBe(true);
  });

  test('reputation_recovery triggers when negative_last7d >= 2 and avg_rating >= 3.5', async () => {
    const ctx = makeCtx({
      reviews: { total: 20, avg_rating: 4.0, negative_last7d: 3, pending_response: 0 },
    });
    const result = await detectOpportunities(ctx, 'trace_03');
    const rep = result.find(o => o.type === 'reputation_recovery');
    expect(rep).toBeDefined();
    expect(rep!.opportunity_score).toBeGreaterThanOrEqual(0.35);
  });
});

// ─── AC5: opportunity/signal dedup ───────────────────────────────────────────

describe('OpportunityDetector — deduplication via upsert', () => {
  test('upsert called once per detected candidate', async () => {
    const ctx = makeCtx({ leads: { total: 5, hot: 4, warm: 1, new: 0, avg_score: 70 } });
    const result = await detectOpportunities(ctx, 'trace_04');
    expect(opportunityRepository.upsert).toHaveBeenCalledTimes(result.length);
  });

  test('upsert receives correct business_id and type', async () => {
    const ctx = makeCtx({ leads: { total: 5, hot: 3, warm: 1, new: 0, avg_score: 60 } });
    await detectOpportunities(ctx, 'trace_05');
    const callArg = (opportunityRepository.upsert as jest.Mock).mock.calls[0][0];
    expect(callArg.business_id).toBe('biz_001');
    expect(callArg.type).toBe('lead_surge');
  });

  test('opportunity.detected event emitted for each opportunity', async () => {
    const ctx = makeCtx({ leads: { total: 5, hot: 3, warm: 1, new: 0, avg_score: 60 } });
    const result = await detectOpportunities(ctx, 'trace_06');
    const emitCalls = (bus.makeEvent as jest.Mock).mock.calls.filter(c => c[0] === 'opportunity.detected');
    expect(emitCalls).toHaveLength(result.length);
  });
});
