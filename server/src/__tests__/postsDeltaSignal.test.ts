/**
 * Unit tests — postsDeltaSignal pure functions.
 * Covers: Instagram count-delta sizing/skip/clamp/unknown, Facebook timestamp-changed
 * skip/unknown. These decide whether the daily posts-scraper Apify call runs at all
 * and how many posts it asks for, so correctness here directly gates real spend.
 */

import {
  computeInstagramDeltaSignal,
  computeFacebookChangedSignal,
  INSTAGRAM_DELTA_CEILING,
} from '../lib/postsDeltaSignal';

describe('computeInstagramDeltaSignal', () => {
  test('increase within the ceiling returns clamped with the exact delta', () => {
    expect(computeInstagramDeltaSignal(8, 5)).toEqual({ kind: 'clamped', limit: 3 });
  });

  test('increase beyond the ceiling clamps to INSTAGRAM_DELTA_CEILING', () => {
    expect(computeInstagramDeltaSignal(500, 5)).toEqual({ kind: 'clamped', limit: INSTAGRAM_DELTA_CEILING });
  });

  test('unchanged count returns skip', () => {
    expect(computeInstagramDeltaSignal(5, 5)).toEqual({ kind: 'skip' });
  });

  test('decrease (deletions) returns unknown, not skip — never risk a silent miss', () => {
    expect(computeInstagramDeltaSignal(3, 5)).toEqual({ kind: 'unknown' });
  });

  test('missing today or prior value returns unknown', () => {
    expect(computeInstagramDeltaSignal(null, 5)).toEqual({ kind: 'unknown' });
    expect(computeInstagramDeltaSignal(5, null)).toEqual({ kind: 'unknown' });
    expect(computeInstagramDeltaSignal(null, null)).toEqual({ kind: 'unknown' });
  });
});

describe('computeFacebookChangedSignal', () => {
  test('same timestamp returns skip', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(computeFacebookChangedSignal(new Date(t), new Date(t))).toEqual({ kind: 'skip' });
  });

  test('different timestamp returns unknown — no count to size the fetch with', () => {
    expect(computeFacebookChangedSignal(new Date('2026-01-02T00:00:00Z'), new Date('2026-01-01T00:00:00Z')))
      .toEqual({ kind: 'unknown' });
  });

  test('missing today or prior value returns unknown', () => {
    expect(computeFacebookChangedSignal(null, new Date())).toEqual({ kind: 'unknown' });
    expect(computeFacebookChangedSignal(new Date(), null)).toEqual({ kind: 'unknown' });
  });
});
