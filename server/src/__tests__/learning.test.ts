/**
 * Unit tests — learning formulas
 *
 * Verifies:
 * - All 7 weight update rules
 * - Temporal decay
 * - Confidence calibration and recalibration
 * - Weight bounds enforcement
 * - Confidence bounds enforcement
 * - Determinism (same inputs → same outputs)
 */

import {
  temporalDecay,
  decayWeightedAverage,
  positiveWeightUpdate,
  negativeWeightUpdate,
  acceptedWeightUpdate,
  ignoredWeightUpdate,
  overrideConfidenceUpdate,
  outcomeSuccessUpdate,
  outcomeFailureUpdate,
  calibrateConfidence,
  recalibrateConfidence,
} from '../learning/learning.formulas';

import { LEARNING_COEFFICIENTS, WEIGHT_BOUNDS, CONFIDENCE_BOUNDS } from '../infra/config';

// ─── Temporal decay ───────────────────────────────────────────────────────────

describe('temporalDecay', () => {
  test('decay at day 0 = 1.0', () => {
    expect(temporalDecay(0, 'long_term')).toBeCloseTo(1.0, 5);
  });

  test('long-term decay slower than short-term at day 7', () => {
    const lt = temporalDecay(7, 'long_term');
    const st = temporalDecay(7, 'short_term');
    expect(lt).toBeGreaterThan(st);
  });

  test('decay is monotonically decreasing', () => {
    const d0  = temporalDecay(0);
    const d7  = temporalDecay(7);
    const d30 = temporalDecay(30);
    expect(d0).toBeGreaterThan(d7);
    expect(d7).toBeGreaterThan(d30);
  });

  test('decay never reaches 0 for finite days', () => {
    expect(temporalDecay(365, 'long_term')).toBeGreaterThan(0);
  });

  test('negative delta treated as 0', () => {
    expect(temporalDecay(-5)).toBeCloseTo(1.0, 5);
  });
});

describe('decayWeightedAverage', () => {
  test('empty array returns 0.5', () => {
    expect(decayWeightedAverage([])).toBe(0.5);
  });

  test('single item returns its score', () => {
    expect(decayWeightedAverage([{ score: 0.8, ageInDays: 0 }])).toBeCloseTo(0.8, 5);
  });

  test('recent items weighted more than old items', () => {
    const result = decayWeightedAverage([
      { score: 1.0, ageInDays: 0 },   // recent high
      { score: 0.0, ageInDays: 30 },  // old low
    ], 'long_term');
    expect(result).toBeGreaterThan(0.5);
  });
});

// ─── Weight update rules ──────────────────────────────────────────────────────

describe('positiveWeightUpdate', () => {
  test('increases weight', () => {
    const old = 0.5;
    expect(positiveWeightUpdate(old)).toBeGreaterThan(old);
  });

  test('formula: new = old + α(1-old)', () => {
    const old = 0.5;
    const expected = old + LEARNING_COEFFICIENTS.alpha * (1 - old);
    expect(positiveWeightUpdate(old)).toBeCloseTo(expected, 10);
  });

  test('weight at max still increases toward max (clamps to 0.90)', () => {
    expect(positiveWeightUpdate(0.89)).toBeLessThanOrEqual(WEIGHT_BOUNDS.max);
  });

  test('output bounded [min, max]', () => {
    const result = positiveWeightUpdate(0.1);
    expect(result).toBeGreaterThanOrEqual(WEIGHT_BOUNDS.min);
    expect(result).toBeLessThanOrEqual(WEIGHT_BOUNDS.max);
  });
});

describe('negativeWeightUpdate', () => {
  test('decreases weight', () => {
    const old = 0.5;
    expect(negativeWeightUpdate(old)).toBeLessThan(old);
  });

  test('formula: new = old - β*old', () => {
    const old = 0.5;
    const expected = old - LEARNING_COEFFICIENTS.beta * old;
    expect(negativeWeightUpdate(old)).toBeCloseTo(expected, 10);
  });

  test('output bounded [min, max]', () => {
    const result = negativeWeightUpdate(WEIGHT_BOUNDS.min);
    expect(result).toBeGreaterThanOrEqual(WEIGHT_BOUNDS.min);
  });
});

describe('acceptedWeightUpdate', () => {
  test('increases weight by gamma * successFactor', () => {
    const old = 0.5;
    const sf  = 1.0;
    const expected = Math.min(WEIGHT_BOUNDS.max, old + LEARNING_COEFFICIENTS.gamma * sf);
    expect(acceptedWeightUpdate(old, sf)).toBeCloseTo(expected, 10);
  });

  test('zero success factor → no change (beyond clamp)', () => {
    const old = 0.5;
    // gamma * 0 = 0, so weight stays the same
    expect(acceptedWeightUpdate(old, 0)).toBeCloseTo(old, 10);
  });
});

describe('ignoredWeightUpdate', () => {
  test('decreases weight by delta fraction', () => {
    const old = 0.5;
    const expected = old - LEARNING_COEFFICIENTS.delta * old;
    expect(ignoredWeightUpdate(old)).toBeCloseTo(expected, 10);
  });

  test('smaller penalty than negativeWeightUpdate (δ < β)', () => {
    const old   = 0.6;
    const after_ignore   = ignoredWeightUpdate(old);
    const after_negative = negativeWeightUpdate(old);
    expect(after_ignore).toBeGreaterThan(after_negative);
  });
});

describe('overrideConfidenceUpdate', () => {
  test('reduces confidence', () => {
    const old = 0.8;
    expect(overrideConfidenceUpdate(old, 1.0)).toBeLessThan(old);
  });

  test('formula: new = old - ε * severity', () => {
    const old = 0.8;
    const sev = 0.5;
    const expected = old - LEARNING_COEFFICIENTS.epsilon * sev;
    expect(overrideConfidenceUpdate(old, sev)).toBeCloseTo(expected, 10);
  });

  test('output clamped to [0, 1]', () => {
    // Very severe override on low confidence
    const result = overrideConfidenceUpdate(0.05, 1.0);
    expect(result).toBeGreaterThanOrEqual(CONFIDENCE_BOUNDS.min);
    expect(result).toBeLessThanOrEqual(CONFIDENCE_BOUNDS.max);
  });
});

describe('outcomeSuccessUpdate', () => {
  test('increases weight', () => {
    const old = 0.5;
    expect(outcomeSuccessUpdate(old, 1.0)).toBeGreaterThan(old);
  });

  test('larger outcome score → larger increase', () => {
    const old  = 0.5;
    const high = outcomeSuccessUpdate(old, 1.0);
    const low  = outcomeSuccessUpdate(old, 0.3);
    expect(high).toBeGreaterThan(low);
  });

  test('output bounded [min, max]', () => {
    const result = outcomeSuccessUpdate(0.88, 1.0);
    expect(result).toBeLessThanOrEqual(WEIGHT_BOUNDS.max);
  });
});

describe('outcomeFailureUpdate', () => {
  test('decreases weight', () => {
    const old = 0.7;
    expect(outcomeFailureUpdate(old, 1.0)).toBeLessThan(old);
  });

  test('larger failure score → larger decrease', () => {
    const old  = 0.7;
    const high = outcomeFailureUpdate(old, 1.0);
    const low  = outcomeFailureUpdate(old, 0.3);
    expect(high).toBeLessThan(low);
  });
});

// ─── Confidence calibration ───────────────────────────────────────────────────

describe('calibrateConfidence', () => {
  test('all-one inputs → 1.0', () => {
    expect(calibrateConfidence({
      source_quality: 1, data_completeness: 1,
      pattern_reliability: 1, model_certainty: 1,
    })).toBeCloseTo(1.0, 5);
  });

  test('all-zero inputs → 0.0', () => {
    expect(calibrateConfidence({
      source_quality: 0, data_completeness: 0,
      pattern_reliability: 0, model_certainty: 0,
    })).toBe(0.0);
  });

  test('output bounded [0, 1]', () => {
    const result = calibrateConfidence({
      source_quality: 0.7, data_completeness: 0.8,
      pattern_reliability: 0.6, model_certainty: 0.9,
    });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('recalibrateConfidence', () => {
  const base = 0.7;

  test('success bonus raises confidence', () => {
    const result = recalibrateConfidence(base, {
      successBonus: 0.03, rejectionPenalty: 0, overridePenalty: 0, staleSignalPenalty: 0,
    });
    expect(result).toBeGreaterThan(base);
  });

  test('all penalties reduce confidence', () => {
    const result = recalibrateConfidence(base, {
      successBonus: 0, rejectionPenalty: 0.05, overridePenalty: 0.07, staleSignalPenalty: 0.02,
    });
    expect(result).toBeLessThan(base);
  });

  test('result never exceeds 1.0', () => {
    const result = recalibrateConfidence(0.99, {
      successBonus: 0.10, rejectionPenalty: 0, overridePenalty: 0, staleSignalPenalty: 0,
    });
    expect(result).toBeLessThanOrEqual(1.0);
  });

  test('result never goes below 0.0', () => {
    const result = recalibrateConfidence(0.01, {
      successBonus: 0, rejectionPenalty: 0.5, overridePenalty: 0.5, staleSignalPenalty: 0.5,
    });
    expect(result).toBeGreaterThanOrEqual(0.0);
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('determinism — same inputs produce same outputs', () => {
  test('positiveWeightUpdate is deterministic', () => {
    expect(positiveWeightUpdate(0.6)).toBe(positiveWeightUpdate(0.6));
  });

  test('temporalDecay is deterministic', () => {
    expect(temporalDecay(14)).toBe(temporalDecay(14));
  });

  test('computeFinalActionScore via import', async () => {
    const { computeFinalActionScore } = await import('../learning/learning.formulas');
    const input = { expected_roi: 0.7, confidence: 0.6, business_fit: 0.5, timing_fit: 0.6, historical_success: 0.55 };
    expect(computeFinalActionScore(input)).toBe(computeFinalActionScore(input));
  });
});
