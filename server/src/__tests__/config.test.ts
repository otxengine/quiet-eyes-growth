/**
 * Unit tests — ConfigResolver
 *
 * Verifies:
 * - Global defaults are returned when no overrides
 * - Tenant overrides take precedence over global
 * - Business overrides take precedence over tenant and global
 * - clearBusinessOverride falls back correctly
 * - snapshot returns all keys
 * - ResolvedConfig includes source and policy_version
 */

import { ConfigResolver, cfg } from '../infra/ConfigResolver';
import { POLICY_VERSION } from '../infra/config';

beforeEach(() => {
  // Reset any overrides set in previous tests
  // ConfigResolver uses module-level Maps — we clear by setting then clearing
  ConfigResolver.clearBusinessOverride('biz_test', 'min_confidence_threshold');
  ConfigResolver.clearBusinessOverride('biz_test', 'auto_min_score');
  ConfigResolver.clearBusinessOverride('biz_test', 'max_concurrent_decisions');
});

// ─── Global defaults ──────────────────────────────────────────────────────────

describe('ConfigResolver — global defaults', () => {
  test('returns global default for min_confidence_threshold', () => {
    const result = ConfigResolver.get('min_confidence_threshold', 'biz_unknown');
    expect(result.value).toBeGreaterThan(0);
    expect(result.source).toBe('global');
  });

  test('returns global default for stale_signal_hours', () => {
    const result = ConfigResolver.get('stale_signal_hours', 'biz_unknown');
    expect(result.value).toBe(48);
    expect(result.source).toBe('global');
  });

  test('returns global default for max_concurrent_decisions', () => {
    const result = ConfigResolver.get('max_concurrent_decisions', 'biz_unknown');
    expect(result.value).toBe(3);
    expect(result.source).toBe('global');
  });

  test('includes policy_version on all resolved configs', () => {
    const result = ConfigResolver.get('learning_alpha', 'biz_unknown');
    expect(result.policy_version).toBe(POLICY_VERSION);
  });
});

// ─── Tenant overrides ─────────────────────────────────────────────────────────

describe('ConfigResolver — tenant overrides', () => {
  test('tenant override takes precedence over global', () => {
    ConfigResolver.setTenantOverride('tenant_001', 'max_concurrent_decisions', 10);
    const result = ConfigResolver.get('max_concurrent_decisions', 'biz_tenant', 'tenant_001');
    expect(result.value).toBe(10);
    expect(result.source).toBe('tenant');
  });

  test('tenant override is not applied for different tenant', () => {
    ConfigResolver.setTenantOverride('tenant_001', 'max_concurrent_decisions', 10);
    const result = ConfigResolver.get('max_concurrent_decisions', 'biz_x', 'tenant_999');
    expect(result.source).toBe('global');
  });

  test('no tenantId falls back to global even when tenant override exists', () => {
    ConfigResolver.setTenantOverride('tenant_001', 'pipeline_cooldown_minutes', 15);
    const result = ConfigResolver.get('pipeline_cooldown_minutes', 'biz_x');
    expect(result.source).toBe('global');
  });
});

// ─── Business overrides ───────────────────────────────────────────────────────

describe('ConfigResolver — business overrides', () => {
  test('business override takes precedence over global', () => {
    ConfigResolver.setBusinessOverride('biz_test', 'min_confidence_threshold', 0.99);
    const result = ConfigResolver.get('min_confidence_threshold', 'biz_test');
    expect(result.value).toBe(0.99);
    expect(result.source).toBe('business');
  });

  test('business override takes precedence over tenant override', () => {
    ConfigResolver.setTenantOverride('tenant_001', 'auto_min_score', 80);
    ConfigResolver.setBusinessOverride('biz_test', 'auto_min_score', 95);
    const result = ConfigResolver.get('auto_min_score', 'biz_test', 'tenant_001');
    expect(result.value).toBe(95);
    expect(result.source).toBe('business');
  });

  test('business override is not applied for different business', () => {
    ConfigResolver.setBusinessOverride('biz_test', 'auto_min_score', 95);
    const result = ConfigResolver.get('auto_min_score', 'biz_other');
    expect(result.source).toBe('global');
  });
});

// ─── clearBusinessOverride ────────────────────────────────────────────────────

describe('ConfigResolver — clearBusinessOverride', () => {
  test('falls back to global after clear', () => {
    ConfigResolver.setBusinessOverride('biz_test', 'max_concurrent_decisions', 99);
    expect(ConfigResolver.val<number>('max_concurrent_decisions', 'biz_test')).toBe(99);

    ConfigResolver.clearBusinessOverride('biz_test', 'max_concurrent_decisions');
    expect(ConfigResolver.val<number>('max_concurrent_decisions', 'biz_test')).toBe(3);
  });

  test('falls back to tenant after clear when tenant override exists', () => {
    ConfigResolver.setTenantOverride('tenant_001', 'max_concurrent_decisions', 7);
    ConfigResolver.setBusinessOverride('biz_test', 'max_concurrent_decisions', 99);

    ConfigResolver.clearBusinessOverride('biz_test', 'max_concurrent_decisions');
    const result = ConfigResolver.get('max_concurrent_decisions', 'biz_test', 'tenant_001');
    expect(result.value).toBe(7);
    expect(result.source).toBe('tenant');
  });
});

// ─── val() convenience ────────────────────────────────────────────────────────

describe('ConfigResolver.val()', () => {
  test('returns raw value without wrapper', () => {
    const value = ConfigResolver.val<number>('stale_signal_hours', 'biz_any');
    expect(typeof value).toBe('number');
    expect(value).toBe(48);
  });

  test('cfg alias works identically', () => {
    expect(cfg.val('stale_insight_hours', 'biz_any')).toBe(6);
  });
});

// ─── snapshot() ───────────────────────────────────────────────────────────────

describe('ConfigResolver.snapshot()', () => {
  test('returns all ConfigKey keys', () => {
    const snap = ConfigResolver.snapshot('biz_snap');
    expect(snap).toHaveProperty('min_confidence_threshold');
    expect(snap).toHaveProperty('auto_min_score');
    expect(snap).toHaveProperty('learning_alpha');
    expect(snap).toHaveProperty('decay_lambda_long');
    expect(snap).toHaveProperty('stale_signal_hours');
    expect(snap).toHaveProperty('max_concurrent_decisions');
    expect(snap).toHaveProperty('run_deep_enrichment');
  });

  test('snapshot respects business overrides', () => {
    ConfigResolver.setBusinessOverride('biz_snap2', 'stale_insight_hours', 12);
    const snap = ConfigResolver.snapshot('biz_snap2');
    expect(snap.stale_insight_hours).toBe(12);
  });
});
