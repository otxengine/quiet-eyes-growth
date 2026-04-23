/**
 * Unit tests — StalenessChecker
 *
 * Verifies:
 * - isSignalStale / signalFreshness
 * - signalConfidenceDecay bounds
 * - assertInsightFresh throws on stale insight
 * - isForecastStale / isForecastRelevant
 * - isRecommendationExpired
 * - assertRecommendationFresh throws on expired
 * - isOpportunityExpired
 * - memoryFreshness levels
 * - checkPipelineFreshness blocking issues
 */

import {
  isSignalStale,
  signalFreshness,
  signalConfidenceDecay,
  isInsightStale,
  assertInsightFresh,
  isForecastStale,
  isForecastRelevant,
  isRecommendationExpired,
  assertRecommendationFresh,
  isOpportunityExpired,
  memoryFreshness,
  checkPipelineFreshness,
  DEFAULT_STALE_WINDOWS,
} from '../infra/StalenessChecker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

// ─── Signal staleness ─────────────────────────────────────────────────────────

describe('isSignalStale', () => {
  test('fresh signal (1h old) is not stale', () => {
    expect(isSignalStale(hoursAgo(1))).toBe(false);
  });

  test('signal just at boundary (48h) is stale', () => {
    expect(isSignalStale(hoursAgo(49))).toBe(true);
  });

  test('old signal (72h) is stale', () => {
    expect(isSignalStale(hoursAgo(72))).toBe(true);
  });

  test('custom stale window is respected', () => {
    expect(isSignalStale(hoursAgo(5), 4)).toBe(true);
    expect(isSignalStale(hoursAgo(3), 4)).toBe(false);
  });
});

describe('signalFreshness', () => {
  test('returns fresh for recent signal', () => {
    expect(signalFreshness(hoursAgo(1))).toBe('fresh');
  });

  test('returns aging at 55% of stale window', () => {
    const h = DEFAULT_STALE_WINDOWS.signal_hours * 0.55;
    expect(signalFreshness(hoursAgo(h))).toBe('aging');
  });

  test('returns stale at 80% of stale window', () => {
    const h = DEFAULT_STALE_WINDOWS.signal_hours * 0.80;
    expect(signalFreshness(hoursAgo(h))).toBe('stale');
  });

  test('returns expired beyond stale window', () => {
    expect(signalFreshness(hoursAgo(100))).toBe('expired');
  });
});

describe('signalConfidenceDecay', () => {
  test('fresh signal returns 1.0', () => {
    expect(signalConfidenceDecay(hoursAgo(1))).toBeCloseTo(1.0, 1);
  });

  test('very old signal floors at 0.2', () => {
    expect(signalConfidenceDecay(hoursAgo(200))).toBe(0.2);
  });

  test('midpoint signal returns value between 0.2 and 1.0', () => {
    const midH = DEFAULT_STALE_WINDOWS.signal_hours * 0.5;
    const decay = signalConfidenceDecay(hoursAgo(midH));
    expect(decay).toBeGreaterThan(0.2);
    expect(decay).toBeLessThan(1.0);
  });

  test('decay is monotonically decreasing as signal ages', () => {
    const d1 = signalConfidenceDecay(hoursAgo(10));
    const d2 = signalConfidenceDecay(hoursAgo(20));
    const d3 = signalConfidenceDecay(hoursAgo(40));
    expect(d1).toBeGreaterThanOrEqual(d2);
    expect(d2).toBeGreaterThanOrEqual(d3);
  });
});

// ─── Insight staleness ────────────────────────────────────────────────────────

describe('isInsightStale', () => {
  test('fresh insight (1h old) is not stale', () => {
    expect(isInsightStale(hoursAgo(1))).toBe(false);
  });

  test('insight older than 6h is stale', () => {
    expect(isInsightStale(hoursAgo(7))).toBe(true);
  });
});

describe('assertInsightFresh', () => {
  test('does not throw for fresh insight', () => {
    expect(() => assertInsightFresh(hoursAgo(1), 'ins_001')).not.toThrow();
  });

  test('throws for stale insight', () => {
    expect(() => assertInsightFresh(hoursAgo(10), 'ins_stale'))
      .toThrow(/ins_stale.*stale/i);
  });

  test('error message includes age and limit', () => {
    expect(() => assertInsightFresh(hoursAgo(10), 'ins_stale'))
      .toThrow(/limit is 6h/);
  });
});

// ─── Forecast staleness ───────────────────────────────────────────────────────

describe('isForecastStale', () => {
  test('future window end is not stale', () => {
    expect(isForecastStale(hoursFromNow(12))).toBe(false);
  });

  test('past window end is stale', () => {
    expect(isForecastStale(hoursAgo(1))).toBe(true);
  });
});

describe('isForecastRelevant', () => {
  test('returns true when now is within window', () => {
    expect(isForecastRelevant(hoursAgo(1), hoursFromNow(6))).toBe(true);
  });

  test('returns false when window has not started', () => {
    expect(isForecastRelevant(hoursFromNow(2), hoursFromNow(8))).toBe(false);
  });

  test('returns false when window has ended', () => {
    expect(isForecastRelevant(hoursAgo(10), hoursAgo(2))).toBe(false);
  });
});

// ─── Recommendation expiration ────────────────────────────────────────────────

describe('isRecommendationExpired', () => {
  test('fresh recommendation is not expired', () => {
    expect(isRecommendationExpired(hoursAgo(1), null)).toBe(false);
  });

  test('recommendation older than 72h is expired', () => {
    expect(isRecommendationExpired(hoursAgo(73), null)).toBe(true);
  });

  test('recommendation with past recommended_timing is expired', () => {
    expect(isRecommendationExpired(hoursAgo(1), hoursAgo(0.5))).toBe(true);
  });

  test('recommendation with future timing is not expired (even if old by hours)', () => {
    expect(isRecommendationExpired(hoursAgo(10), hoursFromNow(2))).toBe(false);
  });
});

describe('assertRecommendationFresh', () => {
  test('does not throw for fresh recommendation', () => {
    expect(() =>
      assertRecommendationFresh(hoursAgo(1), null, 'rec_001'),
    ).not.toThrow();
  });

  test('throws for expired recommendation', () => {
    expect(() =>
      assertRecommendationFresh(hoursAgo(80), null, 'rec_expired'),
    ).toThrow(/rec_expired.*expired/i);
  });

  test('throws when recommended_timing has passed', () => {
    expect(() =>
      assertRecommendationFresh(hoursAgo(1), hoursAgo(1), 'rec_timing'),
    ).toThrow(/rec_timing/);
  });
});

// ─── Opportunity expiration ───────────────────────────────────────────────────

describe('isOpportunityExpired', () => {
  test('recent opportunity is not expired', () => {
    expect(isOpportunityExpired(null, daysAgo(1))).toBe(false);
  });

  test('opportunity older than 7 days is expired', () => {
    expect(isOpportunityExpired(null, daysAgo(8))).toBe(true);
  });

  test('opportunity with past window_end is expired', () => {
    expect(isOpportunityExpired(hoursAgo(1), daysAgo(1))).toBe(true);
  });

  test('opportunity with future window_end is not expired', () => {
    expect(isOpportunityExpired(hoursFromNow(24), daysAgo(6))).toBe(false);
  });
});

// ─── Memory freshness ─────────────────────────────────────────────────────────

describe('memoryFreshness', () => {
  test('returns fresh for recent memory', () => {
    expect(memoryFreshness(daysAgo(3))).toBe('fresh');
  });

  test('returns aging for memory between 7 and 30 days', () => {
    expect(memoryFreshness(daysAgo(15))).toBe('aging');
  });

  test('returns stale for memory older than 30 days', () => {
    expect(memoryFreshness(daysAgo(45))).toBe('stale');
  });
});

// ─── checkPipelineFreshness ───────────────────────────────────────────────────

describe('checkPipelineFreshness', () => {
  test('all ok returns no blocking issues', () => {
    const result = checkPipelineFreshness({
      signalCollectedAt: hoursAgo(1),
      insightCreatedAt:  hoursAgo(1),
      recCreatedAt:      hoursAgo(1),
      recTiming:         null,
    });
    expect(result.signals_ok).toBe(true);
    expect(result.insight_ok).toBe(true);
    expect(result.recommendations_ok).toBe(true);
    expect(result.blocking_issues).toHaveLength(0);
  });

  test('stale signal produces blocking issue', () => {
    const result = checkPipelineFreshness({
      signalCollectedAt: hoursAgo(50),
      insightCreatedAt:  hoursAgo(1),
      recCreatedAt:      hoursAgo(1),
      recTiming:         null,
    });
    expect(result.signals_ok).toBe(false);
    expect(result.blocking_issues).toContain('signals_stale_or_missing');
  });

  test('stale insight produces blocking issue', () => {
    const result = checkPipelineFreshness({
      signalCollectedAt: hoursAgo(1),
      insightCreatedAt:  hoursAgo(10),
      recCreatedAt:      hoursAgo(1),
      recTiming:         null,
    });
    expect(result.insight_ok).toBe(false);
    expect(result.blocking_issues).toContain('insight_stale_or_missing');
  });

  test('missing signal is flagged', () => {
    const result = checkPipelineFreshness({
      signalCollectedAt: null,
      insightCreatedAt:  hoursAgo(1),
      recCreatedAt:      hoursAgo(1),
      recTiming:         null,
    });
    expect(result.signals_ok).toBe(false);
  });

  test('all missing produces three blocking issues', () => {
    const result = checkPipelineFreshness({
      signalCollectedAt: null,
      insightCreatedAt:  null,
      recCreatedAt:      null,
      recTiming:         null,
    });
    expect(result.blocking_issues).toHaveLength(3);
  });
});
