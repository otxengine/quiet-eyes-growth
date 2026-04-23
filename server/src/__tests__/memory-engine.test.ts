/**
 * Unit tests — Learning Layer
 *
 * Covers:
 * BusinessMemoryEngine:
 * - thumbs_up adds to accepted_patterns, removes from rejected
 * - thumbs_down adds to rejected_patterns, removes from accepted
 * - Channel EMA update for known channels
 * - Preferred tone update from Hebrew comment keywords
 * - fullMemoryCycle blended accuracy (recent * 0.6 + all-time * 0.4)
 * - fullMemoryCycle increments learning_version
 * - fullMemoryCycle emits memory.updated
 * - fullMemoryCycle returns { patterns_added, weights_updated, version }
 * - No feedback → early return with default values
 *
 * OutcomeTracker:
 * - recordOutcome saves outcome with correct outcome_score
 * - recordOutcome calls updateWeightFromOutcome
 * - recordOutcome emits outcome.recorded
 * - success result → outcome_score = 1.0
 * - partial result → outcome_score = 0.5
 * - failure result → outcome_score = 0.0
 */

jest.mock('../repositories/LearningRepository', () => ({
  learningRepository: {
    getMemory:           jest.fn(),
    upsertMemory:        jest.fn().mockResolvedValue(undefined),
    upsertPattern:       jest.fn().mockResolvedValue(undefined),
    getRecentFeedback:   jest.fn(),
    upsertAgentProfile:  jest.fn().mockResolvedValue(undefined),
    saveOutcome:         jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../repositories/DecisionRepository', () => ({
  decisionRepository: {
    getDecisionById: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/learning/PolicyWeightUpdater', () => ({
  updateWeightFromOutcome: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../db', () => ({
  prisma: {
    outcomeLog: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  },
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

import { incrementalMemoryUpdate, fullMemoryCycle } from '../services/learning/BusinessMemoryEngine';
import { recordOutcome }                             from '../services/learning/OutcomeTracker';
import { learningRepository }                        from '../repositories/LearningRepository';
import { updateWeightFromOutcome }                   from '../services/learning/PolicyWeightUpdater';
import { bus }                                       from '../events/EventBus';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankMemory(overrides: Record<string, any> = {}) {
  return {
    id:                  'mem_001',
    business_id:         'biz_001',
    rejected_patterns:   JSON.stringify([]),
    accepted_patterns:   JSON.stringify([]),
    feedback_summary:    JSON.stringify({}),
    channel_preferences: JSON.stringify({}),
    timing_preferences:  JSON.stringify({}),
    preferred_tone:      'professional',
    preferred_channels:  JSON.stringify([]),
    learning_version:    0,
    ...overrides,
  };
}

function makeFeedback(overrides: Record<string, any> = {}) {
  return {
    id:          'fb_001',
    linked_business: 'biz_001',
    agent_name:  'ContentAgent',
    score:       1,
    output_type: 'post',
    tags:        'instagram,content',
    created_date: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (learningRepository.getMemory as jest.Mock).mockResolvedValue(blankMemory());
  (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([]);
});

// ─── incrementalMemoryUpdate ───────────────────────────────────────────────────

describe('BusinessMemoryEngine — incrementalMemoryUpdate', () => {
  test('thumbs_up adds pattern to accepted_patterns', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['post'], undefined, undefined, 'post', 'trace_01',
      'thumbs_up',
    );

    const call = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data = call[1];
    const accepted = JSON.parse(data.accepted_patterns);
    expect(accepted).toContain('ContentAgent:post');
  });

  test('thumbs_down adds pattern to rejected_patterns', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', -1, ['post'], undefined, undefined, 'post', 'trace_01',
      'thumbs_down',
    );

    const call = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data = call[1];
    const rejected = JSON.parse(data.rejected_patterns);
    expect(rejected).toContain('ContentAgent:post');
  });

  test('thumbs_up removes pattern from rejected_patterns', async () => {
    (learningRepository.getMemory as jest.Mock).mockResolvedValue(
      blankMemory({ rejected_patterns: JSON.stringify(['ContentAgent:post']) }),
    );

    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['post'], undefined, undefined, 'post', 'trace_01',
      'thumbs_up',
    );

    const call   = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data   = call[1];
    const rejected = JSON.parse(data.rejected_patterns);
    expect(rejected).not.toContain('ContentAgent:post');
  });

  test('thumbs_down removes pattern from accepted_patterns', async () => {
    (learningRepository.getMemory as jest.Mock).mockResolvedValue(
      blankMemory({ accepted_patterns: JSON.stringify(['ContentAgent:post']) }),
    );

    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', -1, ['post'], undefined, undefined, 'post', 'trace_01',
      'thumbs_down',
    );

    const call     = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data     = call[1];
    const accepted = JSON.parse(data.accepted_patterns);
    expect(accepted).not.toContain('ContentAgent:post');
  });

  test('updates channel EMA on accept for known channel tag', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['instagram'], undefined, undefined, 'post', 'trace_01',
      'thumbs_up',
    );

    const call  = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data  = call[1];
    const prefs = JSON.parse(data.channel_preferences);
    // initial 0.5, EMA positive: 0.5*0.80 + 1.0*0.20 = 0.60
    expect(prefs['instagram']).toBeCloseTo(0.60, 2);
  });

  test('updates channel EMA on reject for known channel tag', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', -1, ['facebook'], undefined, undefined, 'post', 'trace_01',
      'thumbs_down',
    );

    const call  = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    const data  = call[1];
    const prefs = JSON.parse(data.channel_preferences);
    // initial 0.5, EMA negative: 0.5*0.80 + 0.0*0.20 = 0.40
    expect(prefs['facebook']).toBeCloseTo(0.40, 2);
  });

  test('updates preferred_tone from Hebrew comment: ישיר → direct', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['post'], undefined, 'תוכן ישיר ומדויק', 'post', 'trace_01',
      'thumbs_up',
    );

    const call = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    expect(call[1].preferred_tone).toBe('direct');
  });

  test('updates preferred_tone from Hebrew comment: חברותי → friendly', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['post'], undefined, 'שפה חברותית ואישית', 'post', 'trace_01',
      'thumbs_up',
    );

    const call = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    expect(call[1].preferred_tone).toBe('friendly');
  });

  test('does not update tone on thumbs_down', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', -1, ['post'], undefined, 'שפה חברותית', 'post', 'trace_01',
      'thumbs_down',
    );

    const call = (learningRepository.upsertMemory as jest.Mock).mock.calls[0];
    // tone unchanged — defaults to 'professional'
    expect(call[1].preferred_tone).toBe('professional');
  });

  test('upsertPattern called when score !== 0', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 1, ['post'], undefined, undefined, 'post', 'trace_01',
    );
    expect(learningRepository.upsertPattern).toHaveBeenCalled();
  });

  test('upsertPattern NOT called when score === 0', async () => {
    await incrementalMemoryUpdate(
      'biz_001', 'ContentAgent', 0, ['post'], undefined, undefined, 'post', 'trace_01',
    );
    expect(learningRepository.upsertPattern).not.toHaveBeenCalled();
  });
});

// ─── fullMemoryCycle ──────────────────────────────────────────────────────────

describe('BusinessMemoryEngine — fullMemoryCycle', () => {
  test('returns default values when no feedback', async () => {
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([]);
    const result = await fullMemoryCycle('biz_001', 'trace_01');
    expect(result).toEqual({ patterns_added: 0, weights_updated: 0, version: 1 });
  });

  test('increments learning_version', async () => {
    (learningRepository.getMemory as jest.Mock).mockResolvedValue(blankMemory({ learning_version: 3 }));
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([
      makeFeedback({ score: 1 }),
    ]);

    const result = await fullMemoryCycle('biz_001', 'trace_01');
    expect(result.version).toBe(4);
  });

  test('computes blended accuracy: recent*0.6 + allTime*0.4', async () => {
    const now    = new Date();
    const recent = new Date(now.getTime() - 2 * 86_400_000); // 2 days ago (within 7d)
    const old    = new Date(now.getTime() - 20 * 86_400_000); // 20 days ago

    const feedback = [
      makeFeedback({ score: 1, agent_name: 'AgentX', created_date: recent.toISOString() }), // recent pos
      makeFeedback({ score: 1, agent_name: 'AgentX', created_date: recent.toISOString() }), // recent pos
      makeFeedback({ score: -1, agent_name: 'AgentX', created_date: old.toISOString() }),   // old neg
      makeFeedback({ score: 1, agent_name: 'AgentX', created_date: old.toISOString() }),    // old pos
    ];
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue(feedback);

    await fullMemoryCycle('biz_001', 'trace_01');

    const upsertCall = (learningRepository.upsertAgentProfile as jest.Mock).mock.calls[0];
    const profile    = upsertCall[2];
    // recent: 2/2 = 1.0, allTime: 3/4 = 0.75, blended = 1.0*0.6 + 0.75*0.4 = 0.9
    expect(profile.accuracy_score).toBeCloseTo(0.9, 1);
  });

  test('emits memory.updated event', async () => {
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([
      makeFeedback({ score: 1 }),
    ]);

    await fullMemoryCycle('biz_001', 'trace_01');

    const types = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(types).toContain('memory.updated');
  });

  test('returns weights_updated = number of unique agents processed', async () => {
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([
      makeFeedback({ agent_name: 'AgentA', score: 1 }),
      makeFeedback({ agent_name: 'AgentB', score: -1 }),
    ]);

    const result = await fullMemoryCycle('biz_001', 'trace_01');
    expect(result.weights_updated).toBe(2);
  });

  test('counts pattern as added when tag frequency >= 2', async () => {
    (learningRepository.getRecentFeedback as jest.Mock).mockResolvedValue([
      makeFeedback({ agent_name: 'AgentA', score: 1, tags: 'instagram,content' }),
      makeFeedback({ agent_name: 'AgentA', score: 1, tags: 'instagram,campaign' }),
    ]);

    const result = await fullMemoryCycle('biz_001', 'trace_01');
    // 'instagram' appears 2 times → 1 pattern added
    expect(result.patterns_added).toBeGreaterThanOrEqual(1);
  });
});

// ─── OutcomeTracker ───────────────────────────────────────────────────────────

describe('OutcomeTracker — recordOutcome', () => {
  test('success result → outcome_score = 1.0', async () => {
    const outcome = await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'success', revenueImpact: 500, notes: 'worked',  traceId: 'trace_01',
    });
    expect(outcome.outcome_score).toBe(1.0);
  });

  test('partial result → outcome_score = 0.5', async () => {
    const outcome = await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'partial', revenueImpact: 200, notes: 'partial', traceId: 'trace_01',
    });
    expect(outcome.outcome_score).toBe(0.5);
  });

  test('failure result → outcome_score = 0.0', async () => {
    const outcome = await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'failure', revenueImpact: null, notes: 'failed', traceId: 'trace_01',
    });
    expect(outcome.outcome_score).toBe(0.0);
  });

  test('calls learningRepository.saveOutcome', async () => {
    await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'success', revenueImpact: null, notes: '', traceId: 'trace_01',
    });
    expect(learningRepository.saveOutcome).toHaveBeenCalledTimes(1);
  });

  test('calls updateWeightFromOutcome with correct success flag', async () => {
    await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'success', revenueImpact: 300, notes: '', traceId: 'trace_01',
    });
    expect(updateWeightFromOutcome).toHaveBeenCalledWith(
      'biz_001', 'ContentAgent', expect.any(String),
      true, 300, 'trace_01',
    );
  });

  test('calls updateWeightFromOutcome with false for failure', async () => {
    await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'failure', revenueImpact: null, notes: '', traceId: 'trace_01',
    });
    expect(updateWeightFromOutcome).toHaveBeenCalledWith(
      'biz_001', 'ContentAgent', expect.any(String),
      false, null, 'trace_01',
    );
  });

  test('emits outcome.recorded event', async () => {
    await recordOutcome({
      decisionId: 'dec_001', businessId: 'biz_001', agentName: 'ContentAgent',
      result: 'success', revenueImpact: null, notes: '', traceId: 'trace_01',
    });
    const types = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(types).toContain('outcome.recorded');
  });

  test('returned outcome has correct decision_id and business_id', async () => {
    const outcome = await recordOutcome({
      decisionId: 'dec_XYZ', businessId: 'biz_ABC', agentName: 'ContentAgent',
      result: 'success', revenueImpact: null, notes: '', traceId: 'trace_01',
    });
    expect(outcome.decision_id).toBe('dec_XYZ');
    expect(outcome.business_id).toBe('biz_ABC');
  });
});
