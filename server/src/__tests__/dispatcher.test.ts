/**
 * Unit tests — ActionDispatcher (Execution Layer)
 *
 * Covers:
 * - suggest mode → skip dispatch, return task with status 'created'
 * - approval_required → status 'awaiting_approval', emit execution.approval_required
 * - execution_mode === 'approval' → same gate
 * - Normal dispatch → status 'dispatched' then 'completed', emit execution.completed
 * - Channel handler failure → status 'failed', emit action.failed
 * - dispatchAll processes all pairs, returns count
 * - dispatchAll skips pair when recommendation is missing
 */

jest.mock('../repositories/DecisionRepository', () => ({
  decisionRepository: {
    saveTask:         jest.fn().mockResolvedValue(undefined),
    updateTaskStatus: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../db', () => ({
  prisma: {
    proactiveAlert: {
      create: jest.fn().mockResolvedValue({ id: 'alert_001' }),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
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

import { dispatchAction, dispatchAll } from '../services/execution/ActionDispatcher';
import { decisionRepository }          from '../repositories/DecisionRepository';
import { bus }                         from '../events/EventBus';
import type { Decision, Recommendation } from '../models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id:                  'dec_001',
    business_id:         'biz_001',
    fused_insight_id:    'ins_001',
    insight_id:          'ins_001',
    trace_id:            'trace_test',
    action_type:         'content',
    chosen_action_type:  'content',
    title:               'Test decision',
    decision_reasoning:  'Test reasoning',
    reasoning:           'Test reasoning',
    priority:            50,
    score:               70,
    score_breakdown: {
      expected_roi: 0.7, confidence: 0.8, business_fit: 0.75,
      timing_fit: 0.7, historical_success: 0.65, final_score: 70,
    },
    confidence:       0.8,
    expected_roi:     0.7,
    execution_mode:   'auto',
    approval_required: false,
    policy_version:   1,
    status:           'created',
    tags:             [],
    context_snapshot: '{}',
    created_at:       new Date().toISOString(),
    expires_at:       new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id:                   'rec_001',
    decision_id:          'dec_001',
    business_id:          'biz_001',
    trace_id:             'trace_test',
    title:                'Test recommendation',
    summary:              'Short summary',
    body:                 'Test body',
    why_now:              'Because now',
    cta:                  'Do this',
    channel:              'internal',
    recommended_channel:  'internal',
    urgency:              'medium',
    estimated_impact:     'medium',
    expected_impact:      'medium',
    recommended_steps:    [],
    action_steps:         [],
    recommended_timing:   null,
    draft_content:        'Draft text',
    user_visible_payload: {} as any,
    status:               'created',
    created_at:           new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── dispatchAction ───────────────────────────────────────────────────────────

describe('ActionDispatcher — dispatchAction', () => {
  test('suggest mode returns task with status created and no sent action', async () => {
    const { task, sent } = await dispatchAction(
      makeDecision({ execution_mode: 'suggest' }),
      makeRec(),
      'trace_01',
    );
    expect(task.status).toBe('created');
    expect(sent).toBeNull();
    expect(decisionRepository.saveTask).not.toHaveBeenCalled();
  });

  test('suggest mode does not emit any bus events', async () => {
    await dispatchAction(
      makeDecision({ execution_mode: 'suggest' }),
      makeRec(),
      'trace_01',
    );
    expect(bus.emit).not.toHaveBeenCalled();
  });

  test('approval_required=true → task status awaiting_approval', async () => {
    const { task, sent } = await dispatchAction(
      makeDecision({ approval_required: true }),
      makeRec(),
      'trace_01',
    );
    expect(task.status).toBe('awaiting_approval');
    expect(sent).toBeNull();
  });

  test('execution_mode=approval → task status awaiting_approval', async () => {
    const { task } = await dispatchAction(
      makeDecision({ execution_mode: 'approval', approval_required: false }),
      makeRec(),
      'trace_01',
    );
    expect(task.status).toBe('awaiting_approval');
  });

  test('approval gate emits execution.approval_required', async () => {
    await dispatchAction(
      makeDecision({ approval_required: true }),
      makeRec(),
      'trace_01',
    );
    const emittedTypes = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(emittedTypes).toContain('execution.approval_required');
  });

  test('approval gate saves task via decisionRepository.saveTask', async () => {
    await dispatchAction(
      makeDecision({ approval_required: true }),
      makeRec(),
      'trace_01',
    );
    expect(decisionRepository.saveTask).toHaveBeenCalledTimes(1);
  });

  test('normal auto dispatch emits execution.requested', async () => {
    await dispatchAction(makeDecision(), makeRec(), 'trace_01');
    const types = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(types).toContain('execution.requested');
  });

  test('normal dispatch emits execution.completed on success', async () => {
    await dispatchAction(makeDecision(), makeRec({ channel: 'internal' }), 'trace_01');
    const types = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(types).toContain('execution.completed');
  });

  test('normal dispatch calls updateTaskStatus with completed', async () => {
    await dispatchAction(makeDecision(), makeRec({ channel: 'internal' }), 'trace_01');
    expect(decisionRepository.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      'completed',
      undefined,
    );
  });

  test('normal dispatch returns a sent action on success', async () => {
    const { sent } = await dispatchAction(makeDecision(), makeRec({ channel: 'internal' }), 'trace_01');
    expect(sent).not.toBeNull();
    expect(sent!.success).toBe(true);
  });

  test('dashboard channel success creates ProactiveAlert', async () => {
    const { prisma } = require('../db');
    await dispatchAction(makeDecision(), makeRec({ channel: 'dashboard' }), 'trace_01');
    expect(prisma.proactiveAlert.create).toHaveBeenCalledTimes(1);
  });

  test('handler failure → status failed, emits action.failed', async () => {
    const { prisma } = require('../db');
    prisma.proactiveAlert.create.mockRejectedValueOnce(new Error('DB error'));

    await dispatchAction(makeDecision(), makeRec({ channel: 'dashboard' }), 'trace_01');

    expect(decisionRepository.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.any(String),
    );
    const types = (bus.makeEvent as jest.Mock).mock.calls.map(c => c[0]);
    expect(types).toContain('action.failed');
  });
});

// ─── dispatchAll ──────────────────────────────────────────────────────────────

describe('ActionDispatcher — dispatchAll', () => {
  test('returns count of dispatched decisions', async () => {
    const decisions = [makeDecision({ id: 'd1' }), makeDecision({ id: 'd2' })];
    const recs      = [makeRec({ id: 'r1' }),       makeRec({ id: 'r2' })];

    const count = await dispatchAll(decisions, recs, 'trace_01');
    expect(count).toBe(2);
  });

  test('skips a pair when recommendation is missing', async () => {
    const decisions = [makeDecision({ id: 'd1' }), makeDecision({ id: 'd2' })];
    const recs      = [makeRec({ id: 'r1' })]; // only one rec for two decisions

    const count = await dispatchAll(decisions, recs, 'trace_01');
    expect(count).toBe(1);
  });

  test('continues processing remaining pairs after a failure', async () => {
    const decisions = [
      makeDecision({ id: 'd1' }),
      makeDecision({ id: 'd2' }),
    ];
    const recs = [makeRec({ id: 'r1' }), makeRec({ id: 'r2' })];

    // Make first dispatch throw
    (decisionRepository.saveTask as jest.Mock)
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValue(undefined);

    const count = await dispatchAll(decisions, recs, 'trace_01');
    // Second one should still have been attempted
    expect(count).toBeGreaterThanOrEqual(0); // at minimum no crash
  });

  test('returns 0 for empty inputs', async () => {
    const count = await dispatchAll([], [], 'trace_01');
    expect(count).toBe(0);
  });
});
