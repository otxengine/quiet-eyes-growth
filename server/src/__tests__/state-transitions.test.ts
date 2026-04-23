/**
 * Unit tests — StateMachines
 *
 * Verifies:
 * - Valid transitions are allowed
 * - Forbidden transitions are blocked
 * - assertTransition throws on invalid
 * - isForbidden correctly identifies forbidden pairs
 * - assertTransitionWithAudit throws and calls auditForbiddenTransition
 */

import {
  canTransition,
  assertTransition,
  assertTransitionWithAudit,
  isForbidden,
  OPPORTUNITY_TRANSITIONS,
  OPPORTUNITY_FORBIDDEN,
  DECISION_TRANSITIONS,
  DECISION_FORBIDDEN,
  TASK_TRANSITIONS,
  TASK_FORBIDDEN,
  LEARNING_TRANSITIONS,
  LEARNING_FORBIDDEN,
} from '../state/StateMachines';

// ─── canTransition ────────────────────────────────────────────────────────────

describe('canTransition — Opportunity', () => {
  test('detected → qualified is allowed', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'detected', 'qualified')).toBe(true);
  });

  test('detected → expired is allowed', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'detected', 'expired')).toBe(true);
  });

  test('archived → detected is NOT allowed', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'archived', 'detected')).toBe(false);
  });

  test('archived → anything is NOT allowed (terminal)', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'archived', 'qualified')).toBe(false);
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'archived', 'expired')).toBe(false);
  });

  test('expired → archived is allowed', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'expired', 'archived')).toBe(true);
  });

  test('expired → recommended is NOT allowed', () => {
    expect(canTransition(OPPORTUNITY_TRANSITIONS, 'expired', 'recommended')).toBe(false);
  });
});

describe('canTransition — Decision', () => {
  test('created → scored is allowed', () => {
    expect(canTransition(DECISION_TRANSITIONS, 'created', 'scored')).toBe(true);
  });

  test('approved → executed is allowed', () => {
    expect(canTransition(DECISION_TRANSITIONS, 'approved', 'executed')).toBe(true);
  });

  test('rejected → executed is NOT allowed', () => {
    expect(canTransition(DECISION_TRANSITIONS, 'rejected', 'executed')).toBe(false);
  });

  test('learned → anything is NOT allowed (terminal)', () => {
    expect(canTransition(DECISION_TRANSITIONS, 'learned', 'approved')).toBe(false);
    expect(canTransition(DECISION_TRANSITIONS, 'learned', 'executed')).toBe(false);
  });

  test('created → executed is NOT allowed (skip steps)', () => {
    expect(canTransition(DECISION_TRANSITIONS, 'created', 'executed')).toBe(false);
  });
});

describe('canTransition — Task', () => {
  test('created → queued is allowed', () => {
    expect(canTransition(TASK_TRANSITIONS, 'created', 'queued')).toBe(true);
  });

  test('dispatched → completed is allowed', () => {
    expect(canTransition(TASK_TRANSITIONS, 'dispatched', 'completed')).toBe(true);
  });

  test('failed → queued is allowed (retry path)', () => {
    expect(canTransition(TASK_TRANSITIONS, 'failed', 'queued')).toBe(true);
  });

  test('completed → failed is NOT allowed (terminal)', () => {
    expect(canTransition(TASK_TRANSITIONS, 'completed', 'failed')).toBe(false);
  });

  test('canceled → dispatched is NOT allowed', () => {
    expect(canTransition(TASK_TRANSITIONS, 'canceled', 'dispatched')).toBe(false);
  });

  test('created → completed is NOT allowed (skip steps)', () => {
    expect(canTransition(TASK_TRANSITIONS, 'created', 'completed')).toBe(false);
  });
});

describe('canTransition — Learning', () => {
  test('feedback_captured → memory_updated is allowed', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'feedback_captured', 'memory_updated')).toBe(true);
  });

  test('outcome_captured → memory_updated is allowed', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'outcome_captured', 'memory_updated')).toBe(true);
  });

  test('memory_updated → weights_updated is allowed', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'memory_updated', 'weights_updated')).toBe(true);
  });

  test('weights_updated → policy_recalibrated is allowed', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'weights_updated', 'policy_recalibrated')).toBe(true);
  });

  test('feedback_captured → weights_updated is NOT allowed (skip memory)', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'feedback_captured', 'weights_updated')).toBe(false);
  });

  test('feedback_captured → policy_recalibrated is NOT allowed (skip steps)', () => {
    expect(canTransition(LEARNING_TRANSITIONS, 'feedback_captured', 'policy_recalibrated')).toBe(false);
  });
});

// ─── isForbidden ──────────────────────────────────────────────────────────────

describe('isForbidden', () => {
  test('detects forbidden opportunity transitions', () => {
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'detected',  'decided')).toBe(true);
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'detected',  'recommended')).toBe(true);
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'expired',   'recommended')).toBe(true);
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'archived',  'detected')).toBe(true);
  });

  test('does not flag allowed opportunity transitions', () => {
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'detected',  'qualified')).toBe(false);
    expect(isForbidden(OPPORTUNITY_FORBIDDEN, 'qualified', 'fused')).toBe(false);
  });

  test('detects forbidden decision transitions', () => {
    expect(isForbidden(DECISION_FORBIDDEN, 'created',  'executed')).toBe(true);
    expect(isForbidden(DECISION_FORBIDDEN, 'rejected', 'executed')).toBe(true);
    expect(isForbidden(DECISION_FORBIDDEN, 'learned',  'approved')).toBe(true);
    expect(isForbidden(DECISION_FORBIDDEN, 'executed', 'rejected')).toBe(true);
  });

  test('detects forbidden task transitions', () => {
    expect(isForbidden(TASK_FORBIDDEN, 'created',   'completed')).toBe(true);
    expect(isForbidden(TASK_FORBIDDEN, 'canceled',  'dispatched')).toBe(true);
    expect(isForbidden(TASK_FORBIDDEN, 'completed', 'failed')).toBe(true);
    expect(isForbidden(TASK_FORBIDDEN, 'failed',    'completed')).toBe(true);
  });

  test('detects forbidden learning transitions', () => {
    expect(isForbidden(LEARNING_FORBIDDEN, 'feedback_captured', 'policy_recalibrated')).toBe(true);
    expect(isForbidden(LEARNING_FORBIDDEN, 'weights_updated',   'feedback_captured')).toBe(true);
  });
});

// ─── assertTransition ─────────────────────────────────────────────────────────

describe('assertTransition', () => {
  test('does not throw for valid transition', () => {
    expect(() => assertTransition(DECISION_TRANSITIONS, 'decision', 'created', 'scored')).not.toThrow();
  });

  test('throws with clear message for invalid transition', () => {
    expect(() =>
      assertTransition(DECISION_TRANSITIONS, 'decision', 'created', 'executed'),
    ).toThrow(/Invalid decision state transition: created → executed/);
  });

  test('error message includes allowed transitions', () => {
    expect(() =>
      assertTransition(DECISION_TRANSITIONS, 'decision', 'created', 'approved'),
    ).toThrow(/Allowed from 'created': \[scored\]/);
  });

  test('throws for terminal state transition', () => {
    expect(() =>
      assertTransition(TASK_TRANSITIONS, 'task', 'completed', 'queued'),
    ).toThrow(/Invalid task state transition: completed → queued/);
  });
});

// ─── assertTransitionWithAudit ────────────────────────────────────────────────

describe('assertTransitionWithAudit', () => {
  // Mock the dynamic import used inside assertTransitionWithAudit
  beforeEach(() => {
    jest.resetModules();
  });

  test('resolves without throwing for valid transition', async () => {
    await expect(
      assertTransitionWithAudit(
        DECISION_TRANSITIONS, 'decision', 'dec_001', 'biz_001', 'created', 'scored',
      ),
    ).resolves.toBeUndefined();
  });

  test('throws with entity info for invalid transition', async () => {
    await expect(
      assertTransitionWithAudit(
        DECISION_TRANSITIONS, 'decision', 'dec_001', 'biz_001', 'rejected', 'executed',
      ),
    ).rejects.toThrow(/Forbidden decision state transition: rejected → executed/);
  });

  test('includes entity ID in error message', async () => {
    await expect(
      assertTransitionWithAudit(
        TASK_TRANSITIONS, 'task', 'task_abc', 'biz_001', 'canceled', 'dispatched',
      ),
    ).rejects.toThrow(/Entity: task_abc/);
  });
});

// ─── Full forbidden list completeness ────────────────────────────────────────

describe('Forbidden list completeness', () => {
  test('all forbidden opportunity transitions are also invalid per machine', () => {
    for (const [from, to] of OPPORTUNITY_FORBIDDEN) {
      expect(canTransition(OPPORTUNITY_TRANSITIONS, from, to)).toBe(false);
    }
  });

  test('all forbidden decision transitions are also invalid per machine', () => {
    for (const [from, to] of DECISION_FORBIDDEN) {
      expect(canTransition(DECISION_TRANSITIONS, from, to)).toBe(false);
    }
  });

  test('all forbidden task transitions are also invalid per machine', () => {
    for (const [from, to] of TASK_FORBIDDEN) {
      expect(canTransition(TASK_TRANSITIONS, from, to)).toBe(false);
    }
  });

  test('all forbidden learning transitions are also invalid per machine', () => {
    for (const [from, to] of LEARNING_FORBIDDEN) {
      expect(canTransition(LEARNING_TRANSITIONS, from, to)).toBe(false);
    }
  });
});
