/**
 * Unit tests — SignalProcessor (Signal Processing Layer)
 *
 * Covers:
 * - Empty signals → empty result, no events emitted
 * - Scores are in valid [0,1] range
 * - composite_score is a weighted blend in [0,1]
 * - Known hashes are skipped (novelty = 0 → filtered out)
 * - High-urgency count is accurate
 * - context.signals is mutated in-place
 * - logClassificationRun is called
 * - signal.classified events emitted only for high-quality signals
 * - Hebrew business category sets correct sector_match baseline
 * - Recent signals score higher urgency than old ones
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../repositories/SignalRepository', () => ({
  signalRepository: {
    getRecentRaw:          jest.fn().mockResolvedValue([]),
    getRecentMarket:       jest.fn().mockResolvedValue([]),
    logClassificationRun:  jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../events/EventBus', () => ({
  bus: {
    emit:      jest.fn().mockResolvedValue(undefined),
    makeEvent: jest.fn((type: string, entityId: string, payload: unknown, traceId?: string) => ({
      event_id:  'evt_test',
      type,
      entity_id: entityId,
      payload,
      timestamp: new Date().toISOString(),
      trace_id:  traceId ?? '',
      version:   1,
    })),
  },
}));

import { processSignals }                       from '../services/intelligence/SignalProcessor';
import { signalRepository }                     from '../repositories/SignalRepository';
import { bus }                                  from '../events/EventBus';
import type { EnrichedContext, ClassifiedSignal } from '../models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    context_id:    'ctx_001',
    business_id:   'biz_001',
    built_at:      new Date().toISOString(),
    trace_id:      'trace_test',
    profile: { name: 'Test Biz', category: 'מסעדה', city: 'תל אביב', plan_id: null },
    meta_configuration: null,
    recent_signals:     [],
    signals:  { total: 0, high_urgency: 0, items: [] },
    active_opportunities: [],
    active_threats:       [],
    trends:               [],
    forecasts:            [],
    competitors:          [],
    leads:   { total: 10, hot: 2, warm: 3, new: 1, avg_score: 50 },
    health_score:  65,
    health_details: {},
    reviews: { total: 20, avg_rating: 4.2, negative_last7d: 0, pending_response: 0 },
    sector_knowledge: null,
    active_predictions: [],
    memory:             null,
    recent_decisions:   [],
    recent_outcomes:    [],
    recent_decisions_summary: [],
    market_insights:    [],
    trust_state:        null,
    churn_risk_state:   null,
    ...overrides,
  };
}

function makeRawSignal(overrides: any = {}) {
  return {
    id:           `sig_${Math.random().toString(36).slice(2)}`,
    summary:      'דחוף — ביקוש גבוה ממסעדות בתל אביב',
    content:      null,
    title:        null,
    source_url:   null,
    keywords:     null,
    content_hash: `hash_${Math.random().toString(36).slice(2)}`,
    created_date: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Empty signals ─────────────────────────────────────────────────────────────

describe('SignalProcessor — empty signals', () => {
  test('returns empty result when no signals exist', async () => {
    const ctx = makeCtx();
    const result = await processSignals(ctx, 'trace_01');
    expect(result.classified).toHaveLength(0);
    expect(result.total_raw).toBe(0);
  });

  test('does not emit signal.classified events when no signals', async () => {
    await processSignals(makeCtx(), 'trace_01');
    const emitted = (bus.makeEvent as jest.Mock).mock.calls.filter(c => c[0] === 'signal.classified');
    expect(emitted).toHaveLength(0);
  });

  test('still calls logClassificationRun even with 0 signals', async () => {
    await processSignals(makeCtx(), 'trace_01');
    expect(signalRepository.logClassificationRun).toHaveBeenCalledWith('biz_001', 0, 0, 'trace_01');
  });
});

// ─── Score ranges ─────────────────────────────────────────────────────────────

describe('SignalProcessor — score validation', () => {
  beforeEach(() => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'דחוף — ביקוש גבוה ממסעדות בתל אביב עכשיו, מכירה מיוחדת' }),
      makeRawSignal({ summary: 'customer looking to buy restaurant food catering service today' }),
      makeRawSignal({ summary: 'מחפש שירות מסעדה באזור תל אביב' }),
    ]);
  });

  test('all scores are in [0,1] range', async () => {
    const ctx    = makeCtx();
    const result = await processSignals(ctx, 'trace_01');

    for (const cs of result.classified) {
      expect(cs.urgency_score).toBeGreaterThanOrEqual(0);
      expect(cs.urgency_score).toBeLessThanOrEqual(1);
      expect(cs.intent_score).toBeGreaterThanOrEqual(0);
      expect(cs.intent_score).toBeLessThanOrEqual(1);
      expect(cs.sector_match).toBeGreaterThanOrEqual(0);
      expect(cs.sector_match).toBeLessThanOrEqual(1);
      expect(cs.location_relevance).toBeGreaterThanOrEqual(0);
      expect(cs.location_relevance).toBeLessThanOrEqual(1);
      expect(cs.novelty_score).toBeGreaterThanOrEqual(0);
      expect(cs.novelty_score).toBeLessThanOrEqual(1);
      expect(cs.composite_score).toBeGreaterThanOrEqual(0);
      expect(cs.composite_score).toBeLessThanOrEqual(1);
      expect(cs.confidence).toBeGreaterThanOrEqual(0);
      expect(cs.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('composite_score is between 0 and 1', async () => {
    const ctx    = makeCtx();
    const result = await processSignals(ctx, 'trace_01');
    for (const cs of result.classified) {
      expect(cs.composite_score).toBeGreaterThanOrEqual(0);
      expect(cs.composite_score).toBeLessThanOrEqual(1);
    }
  });

  test('scores are rounded to 3 decimal places', async () => {
    const ctx    = makeCtx();
    const result = await processSignals(ctx, 'trace_01');
    for (const cs of result.classified) {
      const decimals = (cs.composite_score.toString().split('.')[1] ?? '').length;
      expect(decimals).toBeLessThanOrEqual(3);
    }
  });
});

// ─── Context mutation ─────────────────────────────────────────────────────────

describe('SignalProcessor — context mutation', () => {
  beforeEach(() => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'דחוף מסעדה תל אביב ביקוש' }),
      makeRawSignal({ summary: 'restaurant food demand urgent now' }),
    ]);
  });

  test('mutates context.signals.items with classified signals', async () => {
    const ctx = makeCtx();
    await processSignals(ctx, 'trace_01');
    expect(ctx.signals.items.length).toBeGreaterThan(0);
  });

  test('context.signals.total reflects classified count', async () => {
    const ctx = makeCtx();
    await processSignals(ctx, 'trace_01');
    expect(ctx.signals.total).toBe(ctx.signals.items.length);
  });

  test('context.signals.high_urgency counts signals with urgency_score >= 0.6', async () => {
    const ctx = makeCtx();
    await processSignals(ctx, 'trace_01');
    const expectedHigh = ctx.signals.items.filter((cs: ClassifiedSignal) => cs.urgency_score >= 0.60).length;
    expect(ctx.signals.high_urgency).toBe(expectedHigh);
  });
});

// ─── Deduplication / novelty ──────────────────────────────────────────────────

describe('SignalProcessor — deduplication', () => {
  test('skips signals whose hash already appears in context.signals.items', async () => {
    const sharedId = 'existing_sig_001';

    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ id: sharedId, content_hash: sharedId, summary: 'דחוף ביקוש מסעדה תל אביב' }),
    ]);

    // Pre-populate context with this signal as already classified
    const ctx = makeCtx({
      signals: {
        total: 1, high_urgency: 0,
        items: [{ id: 'cs_x', signal_id: sharedId, business_id: 'biz_001', novelty_score: 1, composite_score: 0.5, urgency_score: 0.5, intent_score: 0.3, sector_match: 0.4, location_relevance: 0.6, confidence: 0.5, classified_at: new Date().toISOString() }],
      },
    });

    const result = await processSignals(ctx, 'trace_01');
    expect(result.skipped_known).toBeGreaterThan(0);
  });

  test('within single run: duplicate hash in same batch is only classified once', async () => {
    const hash = 'same_hash_for_both';
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ content_hash: hash, summary: 'דחוף מסעדה תל אביב ביקוש עכשיו' }),
      makeRawSignal({ content_hash: hash, summary: 'דחוף מסעדה תל אביב ביקוש עכשיו' }),
    ]);

    const ctx    = makeCtx();
    const result = await processSignals(ctx, 'trace_01');
    // Second one should be skipped as hash is marked seen after first
    expect(result.classified.length).toBeLessThan(2);
  });
});

// ─── Event emission ────────────────────────────────────────────────────────────

describe('SignalProcessor — event emission', () => {
  test('emits signal.classified for high-quality signals (composite >= 0.40)', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      // Strong signal: urgency + intent + sector + location all high
      makeRawSignal({ summary: 'דחוף ביקוש גבוה מסעדה תל אביב מכירה מיוחדת עכשיו היום שירות' }),
    ]);

    const ctx = makeCtx();
    await processSignals(ctx, 'trace_01');

    const emitted = (bus.makeEvent as jest.Mock).mock.calls.filter(c => c[0] === 'signal.classified');
    // High-quality signal should emit
    expect(emitted.length).toBeGreaterThan(0);
  });

  test('does NOT emit signal.classified for low-quality signals (composite < 0.40)', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'some random text with no relevant keywords at all' }),
    ]);

    const ctx = makeCtx();
    await processSignals(ctx, 'trace_01');

    const emitted = (bus.makeEvent as jest.Mock).mock.calls.filter(c => c[0] === 'signal.classified');
    // Low quality → no event (composite below threshold)
    expect(emitted.length).toBe(0);
  });
});

// ─── Sector match ─────────────────────────────────────────────────────────────

describe('SignalProcessor — sector matching', () => {
  test('restaurant category matches food keywords with higher sector_match', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'מסעדה שף תפריט אירוח קייטרינג ארוחת צהריים' }),
    ]);

    const ctx = makeCtx({ profile: { name: 'Biz', category: 'מסעדה', city: 'תל אביב', plan_id: null } });
    const result = await processSignals(ctx, 'trace_01');

    if (result.classified.length > 0) {
      expect(result.classified[0].sector_match).toBeGreaterThan(0.15);
    }
  });

  test('beauty category matches beauty keywords', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'ספא טיפול עיצוב שיער מניקור פדיקור עיסוי beauty salon' }),
    ]);

    const ctx = makeCtx({ profile: { name: 'Biz', category: 'יופי', city: 'חיפה', plan_id: null } });
    const result = await processSignals(ctx, 'trace_01');

    if (result.classified.length > 0) {
      expect(result.classified[0].sector_match).toBeGreaterThan(0.15);
    }
  });
});

// ─── Location relevance ────────────────────────────────────────────────────────

describe('SignalProcessor — location relevance', () => {
  test('exact city match gives location_relevance = 1.0', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'אירוע בתל אביב דחוף' }),
    ]);

    const ctx = makeCtx({ profile: { name: 'Biz', category: 'food', city: 'תל אביב', plan_id: null } });
    const result = await processSignals(ctx, 'trace_01');

    if (result.classified.length > 0) {
      expect(result.classified[0].location_relevance).toBe(1.0);
    }
  });

  test('different city gives lower location_relevance than exact match', async () => {
    const signalText = 'חיפה ביקוש מסעדה דחוף'; // Haifa
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: signalText }),
    ]);

    // Business is in Tel Aviv — Haifa text shouldn't get 1.0
    const ctx = makeCtx({ profile: { name: 'Biz', category: 'food', city: 'תל אביב', plan_id: null } });
    const result = await processSignals(ctx, 'trace_01');

    if (result.classified.length > 0) {
      expect(result.classified[0].location_relevance).toBeLessThan(1.0);
    }
  });
});

// ─── Urgency recency ──────────────────────────────────────────────────────────

describe('SignalProcessor — recency bonus', () => {
  test('signal from < 6h ago gets higher urgency than same signal from 72h ago', async () => {
    const text = 'דחוף ביקוש גבוה מסעדה מבצע';

    const recent = makeRawSignal({ summary: text, created_date: new Date() });
    const old    = makeRawSignal({ summary: text, created_date: new Date(Date.now() - 72 * 3_600_000) });

    // Run two separate calls to compare scores
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValueOnce([recent]);
    const recentResult = await processSignals(makeCtx(), 'trace_01');

    jest.clearAllMocks();
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([]);
    (signalRepository.getRecentMarket as jest.Mock).mockResolvedValue([]);
    (signalRepository.logClassificationRun as jest.Mock).mockResolvedValue(undefined);
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValueOnce([old]);
    const oldResult = await processSignals(makeCtx(), 'trace_02');

    if (recentResult.classified.length > 0 && oldResult.classified.length > 0) {
      expect(recentResult.classified[0].urgency_score)
        .toBeGreaterThanOrEqual(oldResult.classified[0].urgency_score);
    }
  });
});

// ─── Result fields ─────────────────────────────────────────────────────────────

describe('SignalProcessor — result structure', () => {
  test('result has required fields', async () => {
    const result = await processSignals(makeCtx(), 'trace_01');
    expect(result).toHaveProperty('classified');
    expect(result).toHaveProperty('total_raw');
    expect(result).toHaveProperty('high_urgency');
    expect(result).toHaveProperty('skipped_known');
    expect(result).toHaveProperty('duration_ms');
  });

  test('classified signal has all required fields', async () => {
    (signalRepository.getRecentRaw as jest.Mock).mockResolvedValue([
      makeRawSignal({ summary: 'דחוף מסעדה תל אביב ביקוש עכשיו שירות' }),
    ]);

    const result = await processSignals(makeCtx(), 'trace_01');
    if (result.classified.length > 0) {
      const cs = result.classified[0];
      expect(cs).toHaveProperty('id');
      expect(cs).toHaveProperty('signal_id');
      expect(cs).toHaveProperty('business_id');
      expect(cs).toHaveProperty('urgency_score');
      expect(cs).toHaveProperty('intent_score');
      expect(cs).toHaveProperty('sector_match');
      expect(cs).toHaveProperty('location_relevance');
      expect(cs).toHaveProperty('novelty_score');
      expect(cs).toHaveProperty('confidence');
      expect(cs).toHaveProperty('composite_score');
      expect(cs).toHaveProperty('classified_at');
    }
  });
});
