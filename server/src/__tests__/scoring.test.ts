/**
 * Unit tests — scoring formulas
 *
 * Verifies:
 * - All formula weights sum to 1.0
 * - Outputs clamped to [0, 1] (or [0, 100] for final score)
 * - Edge cases: all-zero and all-one inputs
 * - Formula linearity and direction correctness
 */

import {
  computeOpportunityScore,
  computeBusinessFitScore,
  computeTimingFitScore,
  computeHistoricalSuccessScore,
  computeFinalActionScore,
} from '../learning/learning.formulas';

import {
  OPPORTUNITY_SCORE_WEIGHTS,
  BUSINESS_FIT_WEIGHTS,
  TIMING_FIT_WEIGHTS,
  HISTORICAL_SUCCESS_WEIGHTS,
  FINAL_SCORE_WEIGHTS,
} from '../infra/config';

// ─── Weight sum verification ──────────────────────────────────────────────────

describe('Config — scoring weight sums', () => {
  function sum(obj: Record<string, number>): number {
    return Object.values(obj).reduce((a, b) => a + b, 0);
  }

  test('opportunity score weights sum to 1.0', () => {
    expect(sum(OPPORTUNITY_SCORE_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  test('business fit weights sum to 1.0', () => {
    expect(sum(BUSINESS_FIT_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  test('timing fit weights sum to 1.0', () => {
    expect(sum(TIMING_FIT_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  test('historical success weights sum to 1.0', () => {
    expect(sum(HISTORICAL_SUCCESS_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  test('final score weights sum to 1.0', () => {
    expect(sum(FINAL_SCORE_WEIGHTS)).toBeCloseTo(1.0, 10);
  });
});

// ─── Opportunity score ────────────────────────────────────────────────────────

describe('computeOpportunityScore', () => {
  test('all-one inputs → score = 1.0', () => {
    expect(computeOpportunityScore({
      signal_relevance:    1,
      novelty_score:       1,
      urgency_score:       1,
      local_context_score: 1,
      trend_strength:      1,
      forecast_support:    1,
    })).toBe(1.0);
  });

  test('all-zero inputs → score = 0.0', () => {
    expect(computeOpportunityScore({
      signal_relevance:    0,
      novelty_score:       0,
      urgency_score:       0,
      local_context_score: 0,
      trend_strength:      0,
      forecast_support:    0,
    })).toBe(0.0);
  });

  test('higher signal_relevance raises score', () => {
    const low  = computeOpportunityScore({ signal_relevance: 0.2, novelty_score: 0.5, urgency_score: 0.5, local_context_score: 0.5, trend_strength: 0.5, forecast_support: 0.5 });
    const high = computeOpportunityScore({ signal_relevance: 0.9, novelty_score: 0.5, urgency_score: 0.5, local_context_score: 0.5, trend_strength: 0.5, forecast_support: 0.5 });
    expect(high).toBeGreaterThan(low);
  });

  test('output clamped to [0, 1] even with out-of-range inputs', () => {
    const score = computeOpportunityScore({
      signal_relevance:    2.0,
      novelty_score:       -0.5,
      urgency_score:       1.5,
      local_context_score: 0,
      trend_strength:      0,
      forecast_support:    0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── Business fit score ───────────────────────────────────────────────────────

describe('computeBusinessFitScore', () => {
  test('high sector_match dominates (weight 0.35)', () => {
    const high = computeBusinessFitScore({
      sector_match: 1.0, geo_match: 0.5, profile_alignment: 0.5,
      historical_acceptance_rate: 0.5, memory_preference_alignment: 0.5,
    });
    const low = computeBusinessFitScore({
      sector_match: 0.0, geo_match: 0.5, profile_alignment: 0.5,
      historical_acceptance_rate: 0.5, memory_preference_alignment: 0.5,
    });
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeCloseTo(0.35, 2);
  });

  test('output bounded [0, 1]', () => {
    const score = computeBusinessFitScore({
      sector_match: 0.6, geo_match: 0.7, profile_alignment: 0.8,
      historical_acceptance_rate: 0.9, memory_preference_alignment: 0.6,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── Timing fit score ─────────────────────────────────────────────────────────

describe('computeTimingFitScore', () => {
  test('critical urgency (immediacy=1.0) greatly boosts score', () => {
    const critical = computeTimingFitScore({
      immediacy_score: 1.0, forecast_window_alignment: 0.5,
      business_open_hours_alignment: 0.5, channel_timing_suitability: 0.5,
      seasonal_alignment: 0.5,
    });
    const low = computeTimingFitScore({
      immediacy_score: 0.1, forecast_window_alignment: 0.5,
      business_open_hours_alignment: 0.5, channel_timing_suitability: 0.5,
      seasonal_alignment: 0.5,
    });
    expect(critical).toBeGreaterThan(low);
  });

  test('output bounded [0, 1]', () => {
    const score = computeTimingFitScore({
      immediacy_score: 0.8, forecast_window_alignment: 0.7,
      business_open_hours_alignment: 0.9, channel_timing_suitability: 0.6,
      seasonal_alignment: 0.5,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── Historical success score ─────────────────────────────────────────────────

describe('computeHistoricalSuccessScore', () => {
  test('all-zero → 0.0', () => {
    expect(computeHistoricalSuccessScore({
      similar_action_success_rate:   0,
      similar_timing_success_rate:   0,
      channel_success_rate:          0,
      recent_positive_feedback_rate: 0,
    })).toBe(0.0);
  });

  test('similar_action dominates (weight 0.40)', () => {
    const high = computeHistoricalSuccessScore({
      similar_action_success_rate: 1.0, similar_timing_success_rate: 0.5,
      channel_success_rate: 0.5, recent_positive_feedback_rate: 0.5,
    });
    const low = computeHistoricalSuccessScore({
      similar_action_success_rate: 0.0, similar_timing_success_rate: 0.5,
      channel_success_rate: 0.5, recent_positive_feedback_rate: 0.5,
    });
    expect(high - low).toBeCloseTo(0.40, 2);
  });
});

// ─── Final action score ───────────────────────────────────────────────────────

describe('computeFinalActionScore', () => {
  test('all-one inputs → 100', () => {
    expect(computeFinalActionScore({
      expected_roi: 1, confidence: 1, business_fit: 1,
      timing_fit: 1, historical_success: 1,
    })).toBe(100);
  });

  test('all-zero inputs → 0', () => {
    expect(computeFinalActionScore({
      expected_roi: 0, confidence: 0, business_fit: 0,
      timing_fit: 0, historical_success: 0,
    })).toBe(0);
  });

  test('output is an integer in [0, 100]', () => {
    const score = computeFinalActionScore({
      expected_roi: 0.6, confidence: 0.7, business_fit: 0.5,
      timing_fit: 0.6, historical_success: 0.55,
    });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('higher ROI raises score proportionally (weight 0.30)', () => {
    const base = computeFinalActionScore({
      expected_roi: 0.5, confidence: 0.5, business_fit: 0.5,
      timing_fit: 0.5, historical_success: 0.5,
    });
    const boosted = computeFinalActionScore({
      expected_roi: 1.0, confidence: 0.5, business_fit: 0.5,
      timing_fit: 0.5, historical_success: 0.5,
    });
    expect(boosted - base).toBeCloseTo(15, 0); // 0.5 delta × 0.30 weight × 100
  });
});
