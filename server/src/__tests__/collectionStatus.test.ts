import { evaluateCollectionStatus } from '../lib/collectionStatus';

// Truth table for §2.1: RawSignal > 0 OR Review > 0 OR connected-account path
describe('evaluateCollectionStatus — KAN-34 §2.1 formula', () => {

  // ── AC1: web/social signals collected ────────────────────────────────────────
  test('AC1: rawSignals > 0 → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 3, reviews: 0, gmbPath: 'not_connected' }))
      .toBe('succeeded');
  });

  test('AC1: social signals only → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 1, reviews: 0, gmbPath: 'not_connected' }))
      .toBe('succeeded');
  });

  // ── AC2: GMB connected, Tavily returns nothing ────────────────────────────────
  test('AC2: rawSignals=0, reviews=0, gmb connected → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 0, reviews: 0, gmbPath: 'success' }))
      .toBe('succeeded');
  });

  test('AC2: reviews from GMB only → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 0, reviews: 2, gmbPath: 'success' }))
      .toBe('succeeded');
  });

  // ── AC3: all collectors return 0 ─────────────────────────────────────────────
  test('AC3: all zero, not connected → not_yet_done', () => {
    expect(evaluateCollectionStatus({ rawSignals: 0, reviews: 0, gmbPath: 'not_connected' }))
      .toBe('not_yet_done');
  });

  test('AC3: all zero, gmb failed → not_yet_done (failed ≠ success)', () => {
    expect(evaluateCollectionStatus({ rawSignals: 0, reviews: 0, gmbPath: 'failed' }))
      .toBe('not_yet_done');
  });

  // ── OR-condition independence ─────────────────────────────────────────────────
  test('signals override a failed gmb path → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 1, reviews: 0, gmbPath: 'failed' }))
      .toBe('succeeded');
  });

  test('reviews override a failed gmb path → succeeded', () => {
    expect(evaluateCollectionStatus({ rawSignals: 0, reviews: 1, gmbPath: 'failed' }))
      .toBe('succeeded');
  });
});
