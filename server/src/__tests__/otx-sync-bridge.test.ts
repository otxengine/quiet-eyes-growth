/**
 * AC6 — sector_profile mapping: sector_key JSON → sector
 * AC5 — Contamination: cleanContaminatedData removes cross-sector market_signals
 *
 * The classified_signals/signals_raw/sector_trends/event_opportunities/
 * actions_recommended sync tasks were removed (their source tables don't
 * exist in the live schema) — see runOTXSyncBridge.ts. Only the
 * competitor_changes and agent_heartbeat sync tasks remain, both backed
 * by live tables.
 */

import { sectorKeyOf, cleanContaminatedData } from '../routes/functions/runOTXSyncBridge';

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

// ── AC6 — sector_profile mapping ───────────────────────────────────────────────

describe('sectorKeyOf — AC6', () => {
  test('parses sector_key out of the JSON blob', () =>
    expect(sectorKeyOf(JSON.stringify({ sector_key: 'restaurant' }))).toBe('restaurant'));
  test('preserves any sector_key value (not just a fixed 4-value set)', () =>
    expect(sectorKeyOf(JSON.stringify({ sector_key: 'legal' }))).toBe('legal'));
  test('missing sector_key → other', () => expect(sectorKeyOf(JSON.stringify({}))).toBe('other'));
  test('null → other', () => expect(sectorKeyOf(null)).toBe('other'));
  test('malformed JSON → other', () => expect(sectorKeyOf('not json')).toBe('other'));
});

// ── AC5 — Contamination (competitor_changes leg only) ──────────────────────────

describe('cleanContaminatedData — AC5', () => {
  test('deletes market_signals whose OTX competitor-change source sector does not match the profile sector', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    // profile is restaurant; biz1 is fitness → the market_signal for biz1's comp change is contaminated
    const profiles   = [{ id: 'p1', created_by: 'u1', sector: 'restaurant' }];
    const bizSectors = new Map([['biz1', 'fitness']]);

    const mockSupa = {
      from: jest.fn((table: string) => {
        if (table === 'competitor_changes') return makeChain([{ id: 'comp1', business_id: 'biz1' }]);
        if (table === 'market_signals')      return makeChain(
          [{ id: 'mkt1', source_description: 'otx_comp:comp1:p1' }],
          { deleteInSpy },
        );
        return makeChain([]);
      }),
    };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(deleteInSpy).toHaveBeenCalledWith('id', ['mkt1']);
  });

  test('does not delete market_signals when sectors match', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    // profile and biz are both restaurant → no contamination
    const profiles   = [{ id: 'p1', created_by: 'u1', sector: 'restaurant' }];
    const bizSectors = new Map([['biz1', 'restaurant']]);

    const mockSupa = {
      from: jest.fn((table: string) => {
        if (table === 'competitor_changes') return makeChain([{ id: 'comp1', business_id: 'biz1' }]);
        if (table === 'market_signals')      return makeChain(
          [{ id: 'mkt1', source_description: 'otx_comp:comp1:p1' }],
          { deleteInSpy },
        );
        return makeChain([]);
      }),
    };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(deleteInSpy).not.toHaveBeenCalled();
  });

  test('short-circuits when all profiles are unclassified (other)', async () => {
    const deleteInSpy = jest.fn(() => Promise.resolve({ error: null }));

    const profiles   = [{ id: 'p1', created_by: 'u1', sector: 'other' }];
    const bizSectors = new Map([['biz1', 'fitness']]);
    const mockSupa   = { from: jest.fn(() => makeChain([], { deleteInSpy })) };

    await cleanContaminatedData(mockSupa as any, profiles as any, bizSectors);

    expect(mockSupa.from).not.toHaveBeenCalled();
    expect(deleteInSpy).not.toHaveBeenCalled();
  });
});
