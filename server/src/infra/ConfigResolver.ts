/**
 * ConfigResolver — three-level config hierarchy.
 *
 * Priority (highest to lowest):
 *   1. business override  (business-specific settings)
 *   2. tenant override    (account/workspace-level defaults)
 *   3. global default     (src/infra/config.ts values)
 *
 * Usage:
 *   const threshold = ConfigResolver.get('min_confidence_threshold', businessId, tenantId);
 *
 * Config version is returned alongside every resolved value so it can be
 * stamped on Decision and LearningUpdate records.
 */

import {
  POLICY_THRESHOLDS,
  COOLDOWN_DAYS,
  LEARNING_COEFFICIENTS,
  POLICY_VERSION,
  DECAY_LAMBDAS,
} from './config';

// ─── Type definitions ─────────────────────────────────────────────────────────

export type ConfigKey =
  | 'min_confidence_threshold'
  | 'auto_confidence_threshold'
  | 'approval_safe_threshold'
  | 'min_score_threshold'
  | 'auto_min_score'
  | 'draft_min_score'
  | 'cooldown_rejected_days'
  | 'cooldown_ignored_days'
  | 'cooldown_override_days'
  | 'learning_alpha'
  | 'learning_beta'
  | 'learning_gamma'
  | 'learning_delta'
  | 'learning_epsilon'
  | 'learning_eta'
  | 'learning_theta'
  | 'decay_lambda_long'
  | 'decay_lambda_short'
  | 'stale_signal_hours'
  | 'stale_insight_hours'
  | 'stale_forecast_hours'
  | 'stale_recommendation_hours'
  | 'max_concurrent_decisions'
  | 'pipeline_cooldown_minutes'
  | 'run_deep_enrichment'
  | 'advanced_agent_budget_daily';

export interface ResolvedConfig<T = number | boolean | string> {
  value:          T;
  source:         'business' | 'tenant' | 'global';
  policy_version: string;
}

// ─── Global defaults ──────────────────────────────────────────────────────────

const GLOBAL_DEFAULTS: Record<ConfigKey, number | boolean | string> = {
  min_confidence_threshold:   POLICY_THRESHOLDS.min_confidence_threshold,
  auto_confidence_threshold:  POLICY_THRESHOLDS.auto_confidence_threshold,
  approval_safe_threshold:    POLICY_THRESHOLDS.approval_safe_threshold,
  min_score_threshold:        POLICY_THRESHOLDS.min_score_threshold,
  auto_min_score:             POLICY_THRESHOLDS.auto_min_score,
  draft_min_score:            POLICY_THRESHOLDS.draft_min_score,
  cooldown_rejected_days:     COOLDOWN_DAYS.rejected_pattern,
  cooldown_ignored_days:      COOLDOWN_DAYS.ignored_pattern,
  cooldown_override_days:     COOLDOWN_DAYS.manual_override,
  learning_alpha:             LEARNING_COEFFICIENTS.alpha,
  learning_beta:              LEARNING_COEFFICIENTS.beta,
  learning_gamma:             LEARNING_COEFFICIENTS.gamma,
  learning_delta:             LEARNING_COEFFICIENTS.delta,
  learning_epsilon:           LEARNING_COEFFICIENTS.epsilon,
  learning_eta:               LEARNING_COEFFICIENTS.eta,
  learning_theta:             LEARNING_COEFFICIENTS.theta,
  decay_lambda_long:          DECAY_LAMBDAS.long_term,
  decay_lambda_short:         DECAY_LAMBDAS.short_term,
  stale_signal_hours:         48,
  stale_insight_hours:        6,
  stale_forecast_hours:       24,
  stale_recommendation_hours: 72,
  max_concurrent_decisions:   3,
  pipeline_cooldown_minutes:  5,
  run_deep_enrichment:        false,
  advanced_agent_budget_daily: 10,
};

// ─── In-memory override stores ────────────────────────────────────────────────
// In production: load from DB on startup or via config service.

const tenantOverrides = new Map<string, Partial<Record<ConfigKey, number | boolean | string>>>();
const businessOverrides = new Map<string, Partial<Record<ConfigKey, number | boolean | string>>>();

// ─── ConfigResolver ────────────────────────────────────────────────────────────

export class ConfigResolver {

  /** Set a tenant-level override */
  static setTenantOverride(
    tenantId: string,
    key: ConfigKey,
    value: number | boolean | string,
  ): void {
    if (!tenantOverrides.has(tenantId)) tenantOverrides.set(tenantId, {});
    tenantOverrides.get(tenantId)![key] = value;
  }

  /** Set a business-level override (highest priority) */
  static setBusinessOverride(
    businessId: string,
    key: ConfigKey,
    value: number | boolean | string,
  ): void {
    if (!businessOverrides.has(businessId)) businessOverrides.set(businessId, {});
    businessOverrides.get(businessId)![key] = value;
  }

  /** Remove a business override (fall back to tenant or global) */
  static clearBusinessOverride(businessId: string, key: ConfigKey): void {
    businessOverrides.get(businessId) && delete businessOverrides.get(businessId)![key];
  }

  /**
   * Resolve a config value for a specific business + tenant.
   * Priority: business > tenant > global.
   */
  static get<T = number>(
    key: ConfigKey,
    businessId: string,
    tenantId?: string,
  ): ResolvedConfig<T> {
    // 1. Business override
    const bizMap = businessOverrides.get(businessId);
    if (bizMap && key in bizMap) {
      return { value: bizMap[key] as unknown as T, source: 'business', policy_version: POLICY_VERSION };
    }

    // 2. Tenant override
    if (tenantId) {
      const tenMap = tenantOverrides.get(tenantId);
      if (tenMap && key in tenMap) {
        return { value: tenMap[key] as unknown as T, source: 'tenant', policy_version: POLICY_VERSION };
      }
    }

    // 3. Global default
    return {
      value: GLOBAL_DEFAULTS[key] as unknown as T,
      source: 'global',
      policy_version: POLICY_VERSION,
    };
  }

  /** Convenience: get raw value (most common usage) */
  static val<T = number>(key: ConfigKey, businessId: string, tenantId?: string): T {
    return this.get<T>(key, businessId, tenantId).value;
  }

  /**
   * Return a snapshot of effective config for a business/tenant pair.
   * Useful for debugging and for stamping on Decision records.
   */
  static snapshot(businessId: string, tenantId?: string): Record<ConfigKey, number | boolean | string> {
    const result = {} as Record<ConfigKey, number | boolean | string>;
    for (const key of Object.keys(GLOBAL_DEFAULTS) as ConfigKey[]) {
      result[key] = this.val(key, businessId, tenantId);
    }
    return result;
  }
}

// ─── Default export for convenience ───────────────────────────────────────────

export const cfg = ConfigResolver;
