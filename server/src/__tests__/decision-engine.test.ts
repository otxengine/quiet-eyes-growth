/**
 * Unit tests — DecisionEngine (Strategy & Decision Layer)
 *
 * Covers:
 * - Eligibility gate: low_confidence blocks candidates
 * - Eligibility gate: duplicate_active blocks same action type
 * - Eligibility gate: rejected_pattern blocks action type from memory
 * - Eligibility gate: low_novelty blocks when classified signals are all stale
 * - Score threshold: candidates below min_score_threshold are skipped
 * - MAX_CONCURRENT_DECISIONS cap at 3
 * - Decision created events emitted
 * - Candidate building from opportunity/threat types
 * - Priority influenced by urgency
 * - decisions sorted by score descending
 */

jest.mock('../repositories/DecisionRepository', () => ({
  decisionRepository: {
    saveDecision: jest.fn().mockResolvedValue(undefined),
    saveTask:     jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/decision/ActionScoringService', () => ({
  scoreAction: jest.fn(),
  determineExecutionMode: jest.fn().mockReturnValue('suggest'),
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

import { makeDecisions }       from '../services/decision/DecisionEngine';
import { decisionRepository }  from '../repositories/DecisionRepository';
import { scoreAction, determineExecutionMode } from '../services/decision/ActionScoringService';
import { bus }                 from '../events/EventBus';
import type { EnrichedContext, FusedInsight } from '../models';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeInsight(overrides: Partial<FusedInsight> = {}): FusedInsight {
  return {
    id:                     'ins_001',
    business_id:            'biz_001',
    trace_id:               'trace_test',
    primary_type:           'opportunity',
    top_summary:            'Test summary',
    top_opportunity:        'Test opportunity',
    urgency:                'high',
    confidence:             0.80,
    expected_business_impact: 'medium',
    expected_impact:        'medium',
    explanation:            'Test explanation',
    contributing_items:     [],
    contributing_signals:   [],
    suggested_action_types: [],
    raw_signals_count:      5,
    trends_count:           2,
    created_at:             new Date().toISOString(),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    context_id:    'ctx_001',
    business_id:   'biz_001',
    built_at:      new Date().toISOString(),
    trace_id:      'trace_test',
    profile: { name: 'Test Biz', category: 'food', city: 'Tel Aviv', plan_id: null },
    meta_configuration: {
      min_confidence_threshold: 0.30,
      min_score_threshold:      30,
      auto_execute_enabled:     false,
      approval_required_channels: [],
      max_concurrent_decisions:   3,
    } as any,
    recent_signals:       [],
    signals:              { total: 5, high_urgency: 2, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:   { total: 10, hot: 2, warm: 3, new: 1, avg_score: 55 },
    health_score:   70,
    health_details: {},
    reviews: { total: 20, avg_rating: 4.2, negative_last7d: 0, pending_response: 0 },
    sector_knowledge:    null,
    active_predictions:  [],
    memory:              null,
    recent_decisions:    [],
    recent_outcomes:     [],
    recent_decisions_summary: [],
    market_insights:     [],
    trust_state:         null,
    churn_risk_state:    null,
    ...overrides,
  };
}

function mockScore(score: number) {
  (scoreAction as jest.Mock).mockResolvedValue({
    expected_roi: 0.7, confidence: 0.8, business_fit: 0.75,
    timing_fit: 0.7, historical_success: 0.65,
    final_score: score,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScore(65);
  (determineExecutionMode as jest.Mock).mockReturnValue('suggest');
});

// ─── Eligibility gates ─────────────────────────────────────────────────────────

describe('DecisionEngine — eligibility gates', () => {
  test('low confidence blocks all candidates', async () => {
    const insight = makeInsight({ confidence: 0.10, urgency: 'high' });
    const ctx     = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any],
      meta_configuration: {
        min_confidence_threshold: 0.50,
        min_score_threshold:      20,
        auto_execute_enabled:     false,
        approval_required_channels: [],
      } as any,
    });

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions).toHaveLength(0);
  });

  test('duplicate active decision blocks same action type', async () => {
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any], // → outreach
      recent_decisions: [{
        id: 'dec_old', action_type: 'outreach', status: 'created',
        score: 70, created_at: new Date().toISOString(),
      }],
    });

    const decisions = await makeDecisions(ctx, insight);
    // outreach should be blocked; other types from urgency fallback may still pass
    const outreachDecisions = decisions.filter(d => d.action_type === 'outreach');
    expect(outreachDecisions).toHaveLength(0);
  });

  test('rejected_pattern from memory blocks matching action type', async () => {
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any], // → outreach
      memory: {
        business_id:          'biz_001',
        preferred_tone:       'professional',
        preferred_channels:   [],
        rejected_patterns:    ['outreach'],  // blocks outreach
        accepted_patterns:    [],
        agent_weights:        {},
        lead_preferences:     {},
        content_style:        {},
        feedback_summary:     {},
        channel_preferences:  {},
        timing_preferences:   {},
        tone_preferences:     [],
        sector_specific_preferences: {},
        last_updated_at:      new Date().toISOString(),
      },
    });

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions.every(d => d.action_type !== 'outreach')).toBe(true);
  });

  test('low novelty blocks when classified signals all have novelty < 0.20', async () => {
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      signals: {
        total: 3, high_urgency: 0,
        items: [
          { id: 's1', signal_id: 's1', business_id: 'biz_001', novelty_score: 0.05, intent_score: 0.5, sector_match: 0.5, location_relevance: 0.5, urgency_score: 0.5, confidence: 0.5, composite_score: 0.5, classified_at: new Date().toISOString() },
          { id: 's2', signal_id: 's2', business_id: 'biz_001', novelty_score: 0.08, intent_score: 0.5, sector_match: 0.5, location_relevance: 0.5, urgency_score: 0.5, confidence: 0.5, composite_score: 0.5, classified_at: new Date().toISOString() },
        ],
      },
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any],
    });

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions).toHaveLength(0);
  });
});

// ─── Score threshold ───────────────────────────────────────────────────────────

describe('DecisionEngine — score threshold', () => {
  test('candidates below min_score_threshold are skipped', async () => {
    mockScore(10); // below default 30
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any],
    });

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions).toHaveLength(0);
  });

  test('candidates at or above min_score_threshold are kept', async () => {
    mockScore(50);
    const insight = makeInsight({
      confidence: 0.80,
      suggested_action_types: ['content'],
    });
    const ctx = makeCtx();

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions.length).toBeGreaterThan(0);
  });
});

// ─── MAX_CONCURRENT_DECISIONS cap ─────────────────────────────────────────────

describe('DecisionEngine — concurrency cap', () => {
  test('caps output at MAX_CONCURRENT_DECISIONS (3)', async () => {
    mockScore(70);
    const insight = makeInsight({
      confidence: 0.80,
      urgency:    'critical', // → 4 candidates from URGENCY_TO_CANDIDATES
      suggested_action_types: ['content', 'pricing', 'expansion', 'alert', 'retention'],
    });
    const ctx = makeCtx({
      active_opportunities: [
        { id: 'o1', type: 'lead_surge' }  as any,
        { id: 'o2', type: 'competitor_gap' } as any,
        { id: 'o3', type: 'demand_spike' }   as any,
        { id: 'o4', type: 'local_event' }    as any,
      ],
    });

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions.length).toBeLessThanOrEqual(3);
  });
});

// ─── Event emission ────────────────────────────────────────────────────────────

describe('DecisionEngine — event emission', () => {
  test('emits decision.created for each decision created', async () => {
    mockScore(65);
    const insight = makeInsight({
      confidence: 0.80,
      suggested_action_types: ['content'],
    });
    const ctx = makeCtx();

    const decisions = await makeDecisions(ctx, insight);
    const emittedDecisionCreated = (bus.makeEvent as jest.Mock).mock.calls
      .filter(c => c[0] === 'decision.created');

    expect(emittedDecisionCreated).toHaveLength(decisions.length);
  });

  test('emits decision.eligibility_failed for blocked candidates', async () => {
    const insight = makeInsight({
      confidence: 0.10, // below threshold → all fail
    });
    const ctx = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge' } as any],
    });

    await makeDecisions(ctx, insight);
    const failed = (bus.makeEvent as jest.Mock).mock.calls
      .filter(c => c[0] === 'decision.eligibility_failed');
    expect(failed.length).toBeGreaterThan(0);
  });
});

// ─── Output ordering ───────────────────────────────────────────────────────────

describe('DecisionEngine — output ordering', () => {
  test('decisions are sorted by score descending', async () => {
    let callCount = 0;
    (scoreAction as jest.Mock).mockImplementation(async () => {
      callCount++;
      const score = callCount === 1 ? 80 : 60;
      return { expected_roi: 0.7, confidence: 0.8, business_fit: 0.75, timing_fit: 0.7, historical_success: 0.65, final_score: score };
    });

    const insight = makeInsight({
      confidence: 0.80,
      suggested_action_types: ['campaign', 'content'],
    });
    const ctx = makeCtx();

    const decisions = await makeDecisions(ctx, insight);
    if (decisions.length >= 2) {
      expect(decisions[0].score).toBeGreaterThanOrEqual(decisions[1].score);
    }
  });
});

// ─── Candidate building ────────────────────────────────────────────────────────

describe('DecisionEngine — candidate building', () => {
  test('builds outreach candidate from lead_surge opportunity', async () => {
    mockScore(70);
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      active_opportunities: [{ id: 'o1', type: 'lead_surge', status: 'detected' } as any],
    });

    const decisions = await makeDecisions(ctx, insight);
    const hasOutreach = decisions.some(d => d.action_type === 'outreach');
    expect(hasOutreach).toBe(true);
  });

  test('builds reputation candidate from reputation_attack threat', async () => {
    mockScore(70);
    const insight = makeInsight({ confidence: 0.80 });
    const ctx     = makeCtx({
      active_threats: [{ id: 't1', type: 'reputation_attack', status: 'detected' } as any],
    });

    const decisions = await makeDecisions(ctx, insight);
    const hasReputation = decisions.some(d => d.action_type === 'reputation');
    expect(hasReputation).toBe(true);
  });

  test('includes suggested_action_types from insight', async () => {
    mockScore(70);
    const insight = makeInsight({
      confidence: 0.80,
      suggested_action_types: ['pricing'],
    });
    const ctx = makeCtx();

    const decisions = await makeDecisions(ctx, insight);
    expect(decisions.some(d => d.action_type === 'pricing')).toBe(true);
  });
});
