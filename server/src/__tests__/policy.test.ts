/**
 * Unit tests — PolicyEngine
 *
 * Verifies:
 * - Automation eligibility rules
 * - Approval requirement rules
 * - Cooldown windows
 * - Channel permissions
 * - Safety policy
 * - Full evaluate() integration
 */

import { PolicyEngine, PolicyContext } from '../decision/decision.policy';
import { POLICY_THRESHOLDS, COOLDOWN_DAYS } from '../infra/config';

const engine = new PolicyEngine();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    businessId:           'biz_test',
    actionType:           'content',
    channel:              'internal',
    confidence:           0.80,
    finalScore:           92,   // above auto_min_score (90) by default
    autoEnabled:          true,
    lastRejectedAt:       null,
    lastIgnoredAt:        null,
    lastOverrideAt:       null,
    recentRejectionCount: 0,
    overrideCount:        0,
    isCustomerFacing:     false,
    hasDraftContent:      false,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ─── Automation eligibility ───────────────────────────────────────────────────

describe('PolicyEngine.checkAutomationEligibility', () => {
  test('eligible when all conditions met (internal channel, high score, high confidence)', () => {
    const ctx    = makeCtx();
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(true);
  });

  test('ineligible when auto_execute is disabled', () => {
    const result = engine.checkAutomationEligibility(makeCtx({ autoEnabled: false }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('auto_execute_disabled');
  });

  test('ineligible when confidence below auto threshold', () => {
    const ctx    = makeCtx({ confidence: POLICY_THRESHOLDS.auto_confidence_threshold - 0.01 });
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('confidence_too_low');
  });

  test('ineligible when score below auto_min_score', () => {
    const ctx    = makeCtx({ finalScore: POLICY_THRESHOLDS.auto_min_score - 1 });
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('score_too_low');
  });

  test('ineligible when channel is external (instagram)', () => {
    // Use score >= auto_min_score so score check passes, channel check fires
    const ctx    = makeCtx({ channel: 'instagram', finalScore: 92 });
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('channel_not_auto_allowed');
  });

  test('ineligible when in rejection cooldown', () => {
    const ctx = makeCtx({ lastRejectedAt: daysAgo(1), finalScore: 92 });
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('in_cooldown');
  });

  test('eligible after cooldown expires', () => {
    const ctx = makeCtx({
      lastRejectedAt: daysAgo(COOLDOWN_DAYS.rejected_pattern + 1),
      finalScore: 92,
    });
    const result = engine.checkAutomationEligibility(ctx);
    expect(result.eligible).toBe(true);
  });
});

// ─── Approval requirement ─────────────────────────────────────────────────────

describe('PolicyEngine.checkApprovalRequired', () => {
  test('not required for internal channel, no draft, high confidence', () => {
    expect(engine.checkApprovalRequired(makeCtx())).toBe(false);
  });

  test('required when channel is instagram (external)', () => {
    expect(engine.checkApprovalRequired(makeCtx({ channel: 'instagram' }))).toBe(true);
  });

  test('required when isCustomerFacing = true', () => {
    expect(engine.checkApprovalRequired(makeCtx({ isCustomerFacing: true }))).toBe(true);
  });

  test('required when hasDraftContent = true', () => {
    expect(engine.checkApprovalRequired(makeCtx({ hasDraftContent: true }))).toBe(true);
  });

  test('required when confidence below approval_safe_threshold', () => {
    const ctx = makeCtx({ confidence: POLICY_THRESHOLDS.approval_safe_threshold - 0.01 });
    expect(engine.checkApprovalRequired(ctx)).toBe(true);
  });

  test('required when overrideCount >= 3', () => {
    expect(engine.checkApprovalRequired(makeCtx({ overrideCount: 3 }))).toBe(true);
  });
});

// ─── Cooldown ─────────────────────────────────────────────────────────────────

describe('PolicyEngine.checkCooldown', () => {
  test('no cooldown when all timestamps null', () => {
    const result = engine.checkCooldown(makeCtx());
    expect(result.inCooldown).toBe(false);
  });

  test('rejection cooldown active within 7 days', () => {
    const result = engine.checkCooldown(makeCtx({ lastRejectedAt: daysAgo(3) }));
    expect(result.inCooldown).toBe(true);
    expect(result.endsAt).toBeDefined();
  });

  test('rejection cooldown expired after 7+ days', () => {
    const result = engine.checkCooldown(makeCtx({ lastRejectedAt: daysAgo(8) }));
    expect(result.inCooldown).toBe(false);
  });

  test('ignore cooldown active within 3 days', () => {
    const result = engine.checkCooldown(makeCtx({ lastIgnoredAt: daysAgo(2) }));
    expect(result.inCooldown).toBe(true);
  });

  test('ignore cooldown expired after 3+ days', () => {
    const result = engine.checkCooldown(makeCtx({ lastIgnoredAt: daysAgo(4) }));
    expect(result.inCooldown).toBe(false);
  });
});

// ─── Safety policy ────────────────────────────────────────────────────────────

describe('PolicyEngine.checkSafetyPolicy', () => {
  test('safe for internal channel', () => {
    const ctx = makeCtx({ executionMode: 'auto', channel: 'internal' });
    expect(engine.checkSafetyPolicy(ctx).safe).toBe(true);
  });

  test('unsafe for external channel in auto mode', () => {
    const ctx = makeCtx({ executionMode: 'auto', channel: 'instagram' });
    expect(engine.checkSafetyPolicy(ctx).safe).toBe(false);
  });

  test('unsafe for customer-facing auto', () => {
    const ctx = makeCtx({ executionMode: 'auto', isCustomerFacing: true, channel: 'internal' });
    expect(engine.checkSafetyPolicy(ctx).safe).toBe(false);
  });

  test('safe for approval mode on external channel', () => {
    const ctx = makeCtx({ executionMode: 'approval', channel: 'instagram' });
    expect(engine.checkSafetyPolicy(ctx).safe).toBe(true);
  });
});

// ─── Full evaluate() ──────────────────────────────────────────────────────────

describe('PolicyEngine.evaluate()', () => {
  test('auto mode for internal channel, high score, high confidence', () => {
    const result = engine.evaluate(makeCtx({
      channel: 'internal', finalScore: 92, confidence: 0.80, autoEnabled: true,
    }));
    expect(result.eligible).toBe(true);
    expect(result.executionMode).toBe('auto');
  });

  test('approval mode for instagram regardless of score', () => {
    const result = engine.evaluate(makeCtx({ channel: 'instagram', finalScore: 95 }));
    expect(result.executionMode).toBe('approval');
    expect(result.requiresApproval).toBe(true);
  });

  test('suggest mode when auto disabled', () => {
    const result = engine.evaluate(makeCtx({
      autoEnabled: false, finalScore: 95, confidence: 0.90,
    }));
    expect(result.executionMode).toBe('suggest');
  });

  test('ineligible when confidence below minimum', () => {
    const result = engine.evaluate(makeCtx({
      confidence: POLICY_THRESHOLDS.min_confidence_threshold - 0.01,
    }));
    expect(result.eligible).toBe(false);
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  test('ineligible when score below minimum', () => {
    const result = engine.evaluate(makeCtx({
      finalScore: POLICY_THRESHOLDS.min_score_threshold - 1,
    }));
    expect(result.eligible).toBe(false);
  });

  test('draft mode when score is 70–89, auto enabled, internal channel', () => {
    const result = engine.evaluate(makeCtx({
      channel: 'internal', finalScore: 75,
      confidence: 0.80, autoEnabled: true,
    }));
    expect(result.executionMode).toBe('draft');
  });
});
