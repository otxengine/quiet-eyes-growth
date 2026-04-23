/**
 * learning.formulas — deterministic formula library.
 *
 * All scoring formulas, learning update rules, temporal decay, and
 * confidence calibration live here.
 *
 * Rules:
 * - Pure functions only — no side effects, no I/O.
 * - All outputs are clamped to their valid range.
 * - All coefficients must come from infra/config.
 */

import {
  LEARNING_COEFFICIENTS,
  DECAY_LAMBDAS,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_BOUNDS,
  WEIGHT_BOUNDS,
  OPPORTUNITY_SCORE_WEIGHTS,
  BUSINESS_FIT_WEIGHTS,
  TIMING_FIT_WEIGHTS,
  HISTORICAL_SUCCESS_WEIGHTS,
  FINAL_SCORE_WEIGHTS,
} from '../infra/config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0.0, max = 1.0): number {
  return Math.max(min, Math.min(max, v));
}

function clampWeight(v: number): number {
  return clamp(v, WEIGHT_BOUNDS.min, WEIGHT_BOUNDS.max);
}

// ─── Temporal decay ───────────────────────────────────────────────────────────

/**
 * Exponential time-decay weight.
 * weight = exp(-lambda * timeDeltaDays)
 *
 * @param timeDeltaDays  days since the event occurred
 * @param mode           'long_term' (λ=0.05) or 'short_term' (λ=0.15)
 */
export function temporalDecay(
  timeDeltaDays: number,
  mode: 'long_term' | 'short_term' = 'long_term',
): number {
  const lambda = DECAY_LAMBDAS[mode];
  return Math.exp(-lambda * Math.max(0, timeDeltaDays));
}

/**
 * Apply decay to a list of scored items and return a recency-weighted average.
 */
export function decayWeightedAverage(
  items: Array<{ score: number; ageInDays: number }>,
  mode: 'long_term' | 'short_term' = 'long_term',
): number {
  if (items.length === 0) return 0.5;
  let weightedSum = 0;
  let totalWeight  = 0;
  for (const item of items) {
    const w = temporalDecay(item.ageInDays, mode);
    weightedSum += item.score * w;
    totalWeight  += w;
  }
  return totalWeight > 0 ? clamp(weightedSum / totalWeight) : 0.5;
}

// ─── Learning update rules ────────────────────────────────────────────────────

/** 1. Positive feedback: new = old + α * (1 - old) */
export function positiveWeightUpdate(
  oldWeight: number,
  alpha: number = LEARNING_COEFFICIENTS.alpha,
): number {
  return clampWeight(oldWeight + alpha * (1 - oldWeight));
}

/** 2. Negative feedback: new = old - β * old */
export function negativeWeightUpdate(
  oldWeight: number,
  beta: number = LEARNING_COEFFICIENTS.beta,
): number {
  return clampWeight(oldWeight - beta * oldWeight);
}

/** 3. Accepted recommendation: new = old + γ * success_factor */
export function acceptedWeightUpdate(
  oldWeight: number,
  successFactor: number,    // 0–1: quality of the success signal
  gamma: number = LEARNING_COEFFICIENTS.gamma,
): number {
  return clampWeight(oldWeight + gamma * clamp(successFactor));
}

/** 4. Ignored recommendation (timeout): new = old - δ * old */
export function ignoredWeightUpdate(
  oldWeight: number,
  delta: number = LEARNING_COEFFICIENTS.delta,
): number {
  return clampWeight(oldWeight - delta * oldWeight);
}

/** 5. Manual override: new_confidence = old - ε * override_severity */
export function overrideConfidenceUpdate(
  oldConfidence: number,
  overrideSeverity: number,  // 0–1
  epsilon: number = LEARNING_COEFFICIENTS.epsilon,
): number {
  return clamp(oldConfidence - epsilon * clamp(overrideSeverity), CONFIDENCE_BOUNDS.min, CONFIDENCE_BOUNDS.max);
}

/** 6. Successful business outcome: new = old + η * outcome_score */
export function outcomeSuccessUpdate(
  oldWeight: number,
  outcomeScore: number,   // 0–1
  eta: number = LEARNING_COEFFICIENTS.eta,
): number {
  return clampWeight(oldWeight + eta * clamp(outcomeScore));
}

/** 7. Failed business outcome: new = old - θ * failure_score */
export function outcomeFailureUpdate(
  oldWeight: number,
  failureScore: number,  // 0–1
  theta: number = LEARNING_COEFFICIENTS.theta,
): number {
  return clampWeight(oldWeight - theta * clamp(failureScore));
}

// ─── Confidence calibration ───────────────────────────────────────────────────

export interface ConfidenceComponents {
  source_quality:      number;  // 0–1: reliability of data source
  data_completeness:   number;  // 0–1: how complete the available data is
  pattern_reliability: number;  // 0–1: how often similar patterns proved right
  model_certainty:     number;  // 0–1: classifier/LLM output certainty
}

/**
 * Initial confidence formula:
 * confidence = 0.30*source_quality + 0.25*data_completeness
 *            + 0.25*pattern_reliability + 0.20*model_certainty
 */
export function calibrateConfidence(components: ConfidenceComponents): number {
  const { source_quality, data_completeness, pattern_reliability, model_certainty } = components;
  const w = CONFIDENCE_WEIGHTS;
  return clamp(
    w.source_quality      * clamp(source_quality) +
    w.data_completeness   * clamp(data_completeness) +
    w.pattern_reliability * clamp(pattern_reliability) +
    w.model_certainty     * clamp(model_certainty),
  );
}

export interface ConfidenceAdjustments {
  successBonus:       number;  // +0.03 per confirmed success
  rejectionPenalty:   number;  // -0.05 per rejection
  overridePenalty:    number;  // -0.07 * overrideCount
  staleSignalPenalty: number;  // -0.02 per week stale
}

/**
 * Recalibrate confidence with outcome-based adjustments.
 * confidence_updated = initial + bonus - penalties
 * Clamped to [0, 1].
 */
export function recalibrateConfidence(
  initial: number,
  adjustments: ConfidenceAdjustments,
): number {
  return clamp(
    initial
    + adjustments.successBonus
    - adjustments.rejectionPenalty
    - adjustments.overridePenalty
    - adjustments.staleSignalPenalty,
    CONFIDENCE_BOUNDS.min,
    CONFIDENCE_BOUNDS.max,
  );
}

// ─── Opportunity score formula ────────────────────────────────────────────────

export interface OpportunityScoreComponents {
  signal_relevance:    number;  // how relevant signals are to this business
  novelty_score:       number;  // how new/unseen this pattern is
  urgency_score:       number;  // time-sensitivity
  local_context_score: number;  // geo/location relevance
  trend_strength:      number;  // z-score or trend magnitude
  forecast_support:    number;  // forecast data backing
}

/**
 * opportunity_score = 0.25*signal_relevance + 0.20*novelty_score
 *                   + 0.20*urgency_score + 0.15*local_context_score
 *                   + 0.10*trend_strength + 0.10*forecast_support
 */
export function computeOpportunityScore(components: OpportunityScoreComponents): number {
  const w = OPPORTUNITY_SCORE_WEIGHTS;
  return clamp(
    w.signal_relevance    * clamp(components.signal_relevance) +
    w.novelty_score       * clamp(components.novelty_score) +
    w.urgency_score       * clamp(components.urgency_score) +
    w.local_context_score * clamp(components.local_context_score) +
    w.trend_strength      * clamp(components.trend_strength) +
    w.forecast_support    * clamp(components.forecast_support),
  );
}

// ─── Business fit score formula ───────────────────────────────────────────────

export interface BusinessFitComponents {
  sector_match:                number;  // 0–1: industry alignment
  geo_match:                   number;  // 0–1: location relevance
  profile_alignment:           number;  // 0–1: business profile fit
  historical_acceptance_rate:  number;  // 0–1: past accept rate for this action type
  memory_preference_alignment: number;  // 0–1: match with learned prefs
}

/**
 * business_fit = 0.35*sector_match + 0.20*geo_match
 *              + 0.15*profile_alignment + 0.15*historical_acceptance_rate
 *              + 0.15*memory_preference_alignment
 */
export function computeBusinessFitScore(components: BusinessFitComponents): number {
  const w = BUSINESS_FIT_WEIGHTS;
  return clamp(
    w.sector_match                 * clamp(components.sector_match) +
    w.geo_match                    * clamp(components.geo_match) +
    w.profile_alignment            * clamp(components.profile_alignment) +
    w.historical_acceptance_rate   * clamp(components.historical_acceptance_rate) +
    w.memory_preference_alignment  * clamp(components.memory_preference_alignment),
  );
}

// ─── Timing fit score formula ─────────────────────────────────────────────────

export interface TimingFitComponents {
  immediacy_score:               number;  // how urgent/time-critical
  forecast_window_alignment:     number;  // aligns with demand forecast window
  business_open_hours_alignment: number;  // within business operating hours
  channel_timing_suitability:    number;  // learned best-time for this channel
  seasonal_alignment:            number;  // seasonal calendar fit
}

/**
 * timing_fit = 0.35*immediacy_score + 0.20*forecast_window_alignment
 *            + 0.20*business_open_hours_alignment
 *            + 0.15*channel_timing_suitability + 0.10*seasonal_alignment
 */
export function computeTimingFitScore(components: TimingFitComponents): number {
  const w = TIMING_FIT_WEIGHTS;
  return clamp(
    w.immediacy_score                * clamp(components.immediacy_score) +
    w.forecast_window_alignment      * clamp(components.forecast_window_alignment) +
    w.business_open_hours_alignment  * clamp(components.business_open_hours_alignment) +
    w.channel_timing_suitability     * clamp(components.channel_timing_suitability) +
    w.seasonal_alignment             * clamp(components.seasonal_alignment),
  );
}

// ─── Historical success score formula ─────────────────────────────────────────

export interface HistoricalSuccessComponents {
  similar_action_success_rate:   number;  // win rate for this action type
  similar_timing_success_rate:   number;  // win rate at this time slot
  channel_success_rate:          number;  // win rate for this channel
  recent_positive_feedback_rate: number;  // recent accept / total rate
}

/**
 * historical_success = 0.40*similar_action_success_rate
 *                    + 0.25*similar_timing_success_rate
 *                    + 0.20*channel_success_rate
 *                    + 0.15*recent_positive_feedback_rate
 */
export function computeHistoricalSuccessScore(components: HistoricalSuccessComponents): number {
  const w = HISTORICAL_SUCCESS_WEIGHTS;
  return clamp(
    w.similar_action_success_rate   * clamp(components.similar_action_success_rate) +
    w.similar_timing_success_rate   * clamp(components.similar_timing_success_rate) +
    w.channel_success_rate          * clamp(components.channel_success_rate) +
    w.recent_positive_feedback_rate * clamp(components.recent_positive_feedback_rate),
  );
}

// ─── Final action score formula ───────────────────────────────────────────────

export interface FinalScoreComponents {
  expected_roi:       number;  // 0–1
  confidence:         number;  // 0–1
  business_fit:       number;  // 0–1
  timing_fit:         number;  // 0–1
  historical_success: number;  // 0–1
}

/**
 * final_action_score = 0.30*expected_roi + 0.20*confidence
 *                    + 0.20*business_fit + 0.15*timing_fit
 *                    + 0.15*historical_success
 *
 * Returns 0–100 (multiply by 100).
 */
export function computeFinalActionScore(components: FinalScoreComponents): number {
  const w = FINAL_SCORE_WEIGHTS;
  const raw =
    w.expected_roi       * clamp(components.expected_roi) +
    w.confidence         * clamp(components.confidence) +
    w.business_fit       * clamp(components.business_fit) +
    w.timing_fit         * clamp(components.timing_fit) +
    w.historical_success * clamp(components.historical_success);
  return Math.round(clamp(raw) * 100);
}
