/**
 * Policy & Learning Configuration — centralized coefficients.
 *
 * All scoring weights, learning coefficients, decay lambdas, and policy thresholds
 * live here. No service should hardcode these values.
 *
 * POLICY_VERSION must be bumped when any coefficient changes.
 */

export const POLICY_VERSION = '1.0.0';

// ─── Final action scoring weights ────────────────────────────────────────────

export const FINAL_SCORE_WEIGHTS = {
  expected_roi:       0.30,
  confidence:         0.20,
  business_fit:       0.20,
  timing_fit:         0.15,
  historical_success: 0.15,
} as const;

// ─── Opportunity score weights ────────────────────────────────────────────────

export const OPPORTUNITY_SCORE_WEIGHTS = {
  signal_relevance:   0.25,
  novelty_score:      0.20,
  urgency_score:      0.20,
  local_context_score: 0.15,
  trend_strength:     0.10,
  forecast_support:   0.10,
} as const;

// ─── Business fit score weights ───────────────────────────────────────────────

export const BUSINESS_FIT_WEIGHTS = {
  sector_match:                 0.35,
  geo_match:                    0.20,
  profile_alignment:            0.15,
  historical_acceptance_rate:   0.15,
  memory_preference_alignment:  0.15,
} as const;

// ─── Timing fit score weights ─────────────────────────────────────────────────

export const TIMING_FIT_WEIGHTS = {
  immediacy_score:                0.35,
  forecast_window_alignment:      0.20,
  business_open_hours_alignment:  0.20,
  channel_timing_suitability:     0.15,
  seasonal_alignment:             0.10,
} as const;

// ─── Historical success score weights ─────────────────────────────────────────

export const HISTORICAL_SUCCESS_WEIGHTS = {
  similar_action_success_rate:   0.40,
  similar_timing_success_rate:   0.25,
  channel_success_rate:          0.20,
  recent_positive_feedback_rate: 0.15,
} as const;

// ─── Initial confidence weights ───────────────────────────────────────────────

export const CONFIDENCE_WEIGHTS = {
  source_quality:      0.30,
  data_completeness:   0.25,
  pattern_reliability: 0.25,
  model_certainty:     0.20,
} as const;

// ─── Learning update coefficients (Greek letters) ────────────────────────────
// Reference:
//   alpha  = positive feedback boost
//   beta   = negative feedback penalty
//   gamma  = accepted recommendation boost
//   delta  = ignored recommendation penalty
//   epsilon = manual override confidence penalty
//   eta    = successful outcome boost
//   theta  = failed outcome penalty

export const LEARNING_COEFFICIENTS = {
  alpha:   0.08,   // positive feedback:   new = old + alpha * (1 - old)
  beta:    0.10,   // negative feedback:   new = old - beta * old
  gamma:   0.06,   // accepted rec:        new = old + gamma * success_factor
  delta:   0.03,   // ignored rec:         new = old - delta * old
  epsilon: 0.07,   // manual override:     new_conf = old - epsilon * severity
  eta:     0.12,   // success outcome:     new = old + eta * outcome_score
  theta:   0.10,   // failure outcome:     new = old - theta * failure_score
} as const;

// ─── Temporal decay lambdas ───────────────────────────────────────────────────

export const DECAY_LAMBDAS = {
  long_term:  0.05,  // for business memory
  short_term: 0.15,  // for recent behavior adaptation
} as const;

// ─── Policy thresholds ────────────────────────────────────────────────────────

export const POLICY_THRESHOLDS = {
  auto_confidence_threshold:    0.75,  // minimum confidence for auto-execution
  approval_safe_threshold:      0.55,  // below this always requires approval
  min_confidence_threshold:     0.30,  // below this no decision created
  min_score_threshold:          30,    // final_score below this is suppressed
  auto_min_score:               90,    // score required for auto mode
  draft_min_score:              70,    // score required for draft mode
} as const;

// ─── Cooldown windows ─────────────────────────────────────────────────────────

export const COOLDOWN_DAYS = {
  rejected_pattern:  7,   // 7 days after rejection
  ignored_pattern:   3,   // 3 days after ignored
  manual_override:   2,   // 2 days after override
} as const;

// ─── Channel policy ───────────────────────────────────────────────────────────

export const EXTERNAL_CHANNELS = new Set([
  'instagram', 'facebook', 'whatsapp', 'email', 'sms', 'paid_ads',
]);

export const APPROVAL_REQUIRED_CHANNELS = new Set([
  'instagram', 'facebook', 'whatsapp', 'email', 'sms', 'paid_ads',
]);

export const AUTO_ALLOWED_CHANNELS = new Set([
  'internal', 'dashboard', 'crm_task',
]);

// ─── Confidence calibration bounds ───────────────────────────────────────────

export const CONFIDENCE_BOUNDS = {
  min: 0.0,
  max: 1.0,
  success_bonus:          0.03,
  rejection_penalty:      0.05,
  override_penalty_max:   0.15,
  stale_signal_days:      14,    // signals older than this decay confidence
  stale_signal_penalty:   0.02,  // per week beyond stale threshold
} as const;

// ─── Weight bounds (for policy weights) ──────────────────────────────────────

export const WEIGHT_BOUNDS = {
  min: 0.10,
  max: 0.90,
} as const;
