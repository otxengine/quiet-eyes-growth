/**
 * AC2 — Event trigger / polling fallback
 * runOTXIntentClassification is the polling fallback for the pg_notify pipeline.
 * Tests verify it classifies unprocessed signals and skips already-processed ones.
 */

import { runOTXIntentClassification } from '../routes/functions/runOTXIntentClassification';
import { getSupabaseOTX } from '../lib/supabaseOTX';

jest.mock('../lib/supabaseOTX');

// ── Chain builder ──────────────────────────────────────────────────────────────

function makeChain(data: any[] = [], insertSpy?: jest.Mock) {
  const resolution = { data, error: null };
  const q: any = {};
  for (const m of ['select', 'eq', 'like', 'not', 'gt', 'gte', 'or', 'order', 'in']) {
    q[m] = jest.fn(() => q);
  }
  q.limit  = jest.fn(() => Promise.resolve(resolution));
  q.insert = insertSpy ?? jest.fn(() => Promise.resolve({ error: null, count: data.length }));
  q.upsert = jest.fn(() => Promise.resolve({ error: null, count: data.length }));
  q.delete = jest.fn(() => ({ in: jest.fn(() => Promise.resolve({ error: null })) }));
  q.then   = (resolve: any, reject?: any) => Promise.resolve(resolution).then(resolve, reject);
  q.catch  = (reject: any) => Promise.resolve(resolution).catch(reject as any);
  return q;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const RAW_SIGNAL = {
  signal_id: 'sig1',
  business_id: 'biz1',
  source_url: 'https://example.com/post',
  // High-intent Hebrew text — should score > INTENT_THRESHOLD (0.65)
  raw_text: 'אני מחפש המלצה על מסעדה טובה בתל אביב',
  geo: 'tel_aviv',
  detected_at_utc: new Date().toISOString(),
  confidence_score: 0.9,
};

const OTX_PROFILE = {
  business_id: 'biz1',
  sector: 'restaurant',
  geo: 'tel_aviv',
  keywords: ['מסעדה', 'אוכל'],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runOTXIntentClassification — AC2 polling fallback', () => {
  afterEach(() => jest.clearAllMocks());

  test('classifies unprocessed signals and writes to classified_signals', async () => {
    const classifiedInsertSpy = jest.fn(() => Promise.resolve({ error: null, count: 1 }));

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'classified_signals')   return makeChain([], classifiedInsertSpy);
        if (table === 'signals_raw')          return makeChain([RAW_SIGNAL]);
        if (table === 'otx_business_profiles') return makeChain([OTX_PROFILE]);
        if (table === 'agent_heartbeat')      return makeChain([]);
        return makeChain([]);
      }),
    });

    await runOTXIntentClassification();

    expect(classifiedInsertSpy).toHaveBeenCalled();
    const insertedRows = (classifiedInsertSpy.mock.calls as any[])[0][0];
    const row = insertedRows[0];
    expect(row.signal_id).toBe('sig1');
    expect(row.qualified).toBe(true);
    expect(row.intent_score).toBeGreaterThan(0.65);
  });

  test('skips already-processed signals (polling dedup)', async () => {
    const classifiedInsertSpy = jest.fn(() => Promise.resolve({ error: null, count: 0 }));

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        // sig1 is already in classified_signals
        if (table === 'classified_signals')   return makeChain([{ signal_id: 'sig1' }], classifiedInsertSpy);
        if (table === 'signals_raw')          return makeChain([RAW_SIGNAL]);
        if (table === 'otx_business_profiles') return makeChain([OTX_PROFILE]);
        if (table === 'agent_heartbeat')      return makeChain([]);
        return makeChain([]);
      }),
    });

    await runOTXIntentClassification();

    expect(classifiedInsertSpy).not.toHaveBeenCalled();
  });

  test('exits early without inserting when signals_raw is empty', async () => {
    const classifiedInsertSpy = jest.fn(() => Promise.resolve({ error: null, count: 0 }));

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'classified_signals')   return makeChain([], classifiedInsertSpy);
        if (table === 'signals_raw')          return makeChain([]);
        if (table === 'otx_business_profiles') return makeChain([OTX_PROFILE]);
        if (table === 'agent_heartbeat')      return makeChain([]);
        return makeChain([]);
      }),
    });

    await runOTXIntentClassification();

    expect(classifiedInsertSpy).not.toHaveBeenCalled();
  });
});
