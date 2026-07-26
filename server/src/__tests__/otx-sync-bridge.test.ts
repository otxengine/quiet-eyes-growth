/**
 * AC3 — Bridge happy path: N entities created per matching profile
 * AC4 — Bridge dedup: no duplicate on re-sync
 * AC5 — Contamination: cleanContaminatedData removes cross-sector rows
 * AC6 — Category mapping: Hebrew → sector
 * AC7 — SLA/lag: lag computed correctly from oldest signal timestamp
 */

import { runOTXSyncBridge, categoryToSector, cleanContaminatedData } from '../routes/functions/runOTXSyncBridge';
import { getSupabaseOTX } from '../lib/supabaseOTX';

jest.mock('../lib/supabaseOTX');

// ── Chain builder ──────────────────────────────────────────────────────────────

function makeChain(data: any[] = [], opts: { insertSpy?: jest.Mock; deleteInSpy?: jest.Mock } = {}) {
  const resolution = { data, error: null };
  const q: any = {};
  for (const m of ['select', 'eq', 'like', 'not', 'gt', 'gte', 'or', 'order', 'in']) {
    q[m] = jest.fn(() => q);
  }
  q.limit  = jest.fn(() => Promise.resolve(resolution));
  q.insert = opts.insertSpy ?? jest.fn(() => Promise.resolve({ error: null }));
  q.upsert = jest.fn(() => Promise.resolve({ error: null, count: data.length }));
  const deleteInSpy = opts.deleteInSpy ?? jest.fn(() => Promise.resolve({ error: null }));
  q.delete = jest.fn(() => ({ in: deleteInSpy }));
  q.then   = (resolve: any, reject?: any) => Promise.resolve(resolution).then(resolve, reject);
  q.catch  = (reject: any) => Promise.resolve(resolution).catch(reject as any);
  return q;
}

// ── AC6 — Category mapping ─────────────────────────────────────────────────────

describe('categoryToSector — AC6', () => {
  test('מסעדה → restaurant', () => expect(categoryToSector('מסעדה')).toBe('restaurant'));
  test('מכון כושר → fitness',  () => expect(categoryToSector('מכון כושר')).toBe('fitness'));
  test('מספרה → beauty',       () => expect(categoryToSector('מספרה')).toBe('beauty'));
  test('unknown → local',      () => expect(categoryToSector('unknown')).toBe('local'));
  test('empty string → local', () => expect(categoryToSector('')).toBe('local'));
});

// ── AC7 — SLA/lag (inline calculation test) ────────────────────────────────────

describe('SLA/lag — AC7', () => {
  test('lag from a 5-min-old signal is < 10 min', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const lagMs = Date.now() - Date.parse(fiveMinAgo);
    expect(lagMs).toBeGreaterThan(0);
    expect(lagMs).toBeLessThan(10 * 60_000);
  });

  test('bridge heartbeat status is OK when signals_raw lag < 10 min', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const heartbeatInsertSpy = jest.fn(() => Promise.resolve({ error: null }));
    const leadsInsertSpy = jest.fn(() => Promise.resolve({ error: null }));

    // 2 local profiles → cleanContaminatedData short-circuits
    const profiles = [
      { id: 'p1', created_by: 'u1', category: 'local' },
      { id: 'p2', created_by: 'u2', category: 'local' },
    ];
    const bizSectors = [{ id: 'biz1', sector: 'restaurant' }];
    const signal = {
      signal_id: 'sig1', business_id: 'biz1',
      source_type: 'trend', source_url: 'https://example.com',
      raw_text: 'trend text', geo: 'tel_aviv',
      detected_at_utc: fiveMinAgo, confidence_score: 0.9,
    };

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles') return makeChain(profiles);
        if (table === 'businesses')        return makeChain(bizSectors);
        if (table === 'signals_raw')       return makeChain([signal]);
        if (table === 'agent_heartbeat')   return makeChain([], { insertSpy: heartbeatInsertSpy });
        if (table === 'leads')             return makeChain([], { insertSpy: leadsInsertSpy });
        return makeChain([], { insertSpy: jest.fn(() => Promise.resolve({ error: null })) });
      }),
    });

    await runOTXSyncBridge();

    expect(heartbeatInsertSpy).toHaveBeenCalled();
    const heartbeatArg = (heartbeatInsertSpy.mock.calls as any[])[0][0];
    expect(heartbeatArg.status).toBe('OK');
  });
});

// ── AC3 — Bridge happy path ────────────────────────────────────────────────────

describe('runOTXSyncBridge — AC3 happy path', () => {
  test('creates 1 lead per profile for a matching classified signal', async () => {
    const leadsInsertSpy = jest.fn(() => Promise.resolve({ error: null }));

    // 2 local-sector profiles — cleanContaminatedData short-circuits for local profiles
    const profiles = [
      { id: 'p1', created_by: 'u1', category: 'local' },
      { id: 'p2', created_by: 'u2', category: 'local' },
    ];
    const bizSectors = [{ id: 'biz1', sector: 'restaurant' }];
    const signal = {
      id: 'sig1', business_id: 'biz1',
      intent_score: 0.9, geo_match_score: 0.8, sector_match_score: 0.8,
      source_url: 'https://example.com', confidence_score: 0.9,
      processed_at: new Date().toISOString(),
    };

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles')  return makeChain(profiles);
        if (table === 'businesses')         return makeChain(bizSectors);
        if (table === 'classified_signals') return makeChain([signal]);
        if (table === 'leads')              return makeChain([], { insertSpy: leadsInsertSpy });
        return makeChain([], { insertSpy: jest.fn(() => Promise.resolve({ error: null })) });
      }),
    });

    await runOTXSyncBridge();

    expect(leadsInsertSpy).toHaveBeenCalled();
    const insertedLeads = (leadsInsertSpy.mock.calls as any[])[0][0];
    // 1 signal × 2 profiles = 2 leads
    expect(insertedLeads).toHaveLength(2);
    expect(insertedLeads[0]).toMatchObject({
      linked_business: expect.any(String),
      source: 'otx_engine',
      source_origin: 'otx_engine',
    });
  });
});

// ── AC4 — Bridge dedup ─────────────────────────────────────────────────────────

describe('runOTXSyncBridge — AC4 dedup', () => {
  test('does not insert leads that are already synced', async () => {
    const leadsInsertSpy = jest.fn(() => Promise.resolve({ error: null }));

    const profiles = [
      { id: 'p1', created_by: 'u1', category: 'local' },
      { id: 'p2', created_by: 'u2', category: 'local' },
    ];
    const bizSectors = [{ id: 'biz1', sector: 'restaurant' }];
    const signal = {
      id: 'sig1', business_id: 'biz1',
      intent_score: 0.9, geo_match_score: 0.8, sector_match_score: 0.8,
      source_url: 'https://example.com', confidence_score: 0.9,
      processed_at: new Date().toISOString(),
    };
    // Both keys already exist — bridge should skip insert
    const existingLeads = [
      { source_description: 'otx_sig:sig1:p1' },
      { source_description: 'otx_sig:sig1:p2' },
    ];

    (getSupabaseOTX as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'business_profiles')  return makeChain(profiles);
        if (table === 'businesses')         return makeChain(bizSectors);
        if (table === 'classified_signals') return makeChain([signal]);
        // Leads table: read returns existing keys, write uses spy
        if (table === 'leads') {
          const chain = makeChain(existingLeads, { insertSpy: leadsInsertSpy });
          return chain;
        }
        return makeChain([], { insertSpy: jest.fn(() => Promise.resolve({ error: null })) });
      }),
    });

    await runOTXSyncBridge();

    expect(leadsInsertSpy).not.toHaveBeenCalled();
  });
});

// ── AC5 — Contamination ────────────────────────────────────────────────────────

describe('cleanContaminatedData — AC5', () => {
  test('deletes leads whose OTX source sector does not match the profile sector', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    // profile is restaurant; biz1 is fitness → the lead for biz1 signal is contaminated
    const profiles    = [{ id: 'p1', created_by: 'u1', sector: 'restaurant' }];
    const bizSectors  = new Map([['biz1', 'fitness']]);

    const mockSupa = {
      from: jest.fn((table: string) => {
        if (table === 'classified_signals') return makeChain([{ id: 'csig1', business_id: 'biz1' }]);
        if (table === 'signals_raw')        return makeChain([{ signal_id: 'rsig1', business_id: 'biz1' }]);
        if (table === 'competitor_changes') return makeChain([]);
        if (table === 'sector_trends')      return makeChain([]);
        if (table === 'leads')              return makeChain(
          [{ id: 'lead1', source_description: 'otx_sig:csig1:p1' }],
          { deleteInSpy },
        );
        if (table === 'raw_signals')        return makeChain([]);
        if (table === 'market_signals')     return makeChain([]);
        return makeChain([]);
      }),
    };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(deleteInSpy).toHaveBeenCalledWith('id', ['lead1']);
  });

  test('does not delete leads when sectors match', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    // profile and biz are both restaurant → no contamination
    const profiles   = [{ id: 'p1', created_by: 'u1', sector: 'restaurant' }];
    const bizSectors = new Map([['biz1', 'restaurant']]);

    const mockSupa = {
      from: jest.fn((table: string) => {
        if (table === 'classified_signals') return makeChain([{ id: 'csig1', business_id: 'biz1' }]);
        if (table === 'signals_raw')        return makeChain([{ signal_id: 'rsig1', business_id: 'biz1' }]);
        if (table === 'competitor_changes') return makeChain([]);
        if (table === 'sector_trends')      return makeChain([]);
        if (table === 'leads')              return makeChain(
          [{ id: 'lead1', source_description: 'otx_sig:csig1:p1' }],
          { deleteInSpy },
        );
        if (table === 'raw_signals')        return makeChain([]);
        if (table === 'market_signals')     return makeChain([]);
        return makeChain([]);
      }),
    };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(deleteInSpy).not.toHaveBeenCalled();
  });

  test('short-circuits when all profiles are local', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    const profiles   = [{ id: 'p1', created_by: 'u1', sector: 'local' }];
    const bizSectors = new Map([['biz1', 'fitness']]);
    const mockSupa   = { from: jest.fn(() => makeChain([], { deleteInSpy })) };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(mockSupa.from).not.toHaveBeenCalled();
    expect(deleteInSpy).not.toHaveBeenCalled();
  });
});
