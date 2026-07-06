/**
 * AC1 — OTX SignalCollector
 * - Rows land in signals_raw with correct shape
 * - In-run dedup drops duplicate rows
 * - One failing source does not abort remaining sources
 */

import { collectOTXSignals } from '../routes/functions/collectOTXSignals';
import { getSupabaseOTX } from '../lib/supabaseOTX';

jest.mock('../lib/supabaseOTX');

const BUSINESS = { id: 'biz1', name: 'Test Biz', sector: 'restaurant', geo_city: 'tel_aviv', price_tier: null };

function makeSupaMock(upsertSpy: jest.Mock, insertSpy: jest.Mock) {
  const mockFrom = jest.fn((table: string) => {
    const data = table === 'businesses' ? [BUSINESS] : [];
    const chain: any = {};
    for (const m of ['select', 'eq', 'not', 'like', 'order', 'in']) chain[m] = jest.fn(() => chain);
    chain.limit = jest.fn(() => Promise.resolve({ data, error: null }));
    chain.upsert = upsertSpy;
    chain.insert = insertSpy;
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data, error: null }).then(resolve, reject);
    return chain;
  });
  return { from: mockFrom };
}

function makeSerpResponse(results: { link: string; title: string; snippet: string }[]) {
  return {
    ok: true,
    json: async () => ({ organic_results: results }),
  };
}

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    SERPAPI_KEY: 'test-serp-key',
    TAVILY_API_KEY: 'test-tavily-key',
    GOOGLE_PLACES_API_KEY: 'test-places-key',
  };
});

afterEach(() => {
  process.env = OLD_ENV;
  jest.clearAllMocks();
});

describe('collectOTXSignals — AC1', () => {
  test('rows land in signals_raw with correct shape', async () => {
    const upsertSpy = jest.fn().mockResolvedValue({ error: null, count: 1 });
    const insertSpy = jest.fn().mockResolvedValue({ error: null });
    (getSupabaseOTX as jest.Mock).mockReturnValue(makeSupaMock(upsertSpy, insertSpy));

    const serpResult = { link: 'https://example.com/rest', title: 'Best Restaurant TLV', snippet: 'Great food' };
    global.fetch = jest.fn((url: string) => {
      const u = String(url);
      // Google Trends (must check before generic serpapi to avoid early match)
      if (u.includes('serpapi.com') && u.includes('engine=google_trends')) return Promise.resolve({ ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) });
      // SerpAPI organic search (hl=iw is the Hebrew locale param unique to this call)
      if (u.includes('serpapi.com') && u.includes('hl=iw')) return Promise.resolve(makeSerpResponse([serpResult]));
      // Reddit
      if (u.includes('reddit.com')) return Promise.resolve({ ok: true, json: async () => ({ data: { children: [] } }) });
      // Tavily
      if (u.includes('tavily.com')) return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
      // Places findplacefromtext
      if (u.includes('findplacefromtext')) return Promise.resolve({ ok: true, json: async () => ({ candidates: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as any;

    await collectOTXSignals();

    expect(upsertSpy).toHaveBeenCalled();
    const [rows] = upsertSpy.mock.calls[0];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row).toMatchObject({
      business_id: 'biz1',
      source_url: expect.any(String),
      raw_text: expect.any(String),
      geo: expect.any(String),
      detected_at_utc: expect.any(String),
      confidence_score: expect.any(Number),
    });
  });

  test('in-run dedup drops rows with identical business_id+source_url+raw_text', async () => {
    const upsertSpy = jest.fn().mockResolvedValue({ error: null, count: 1 });
    const insertSpy = jest.fn().mockResolvedValue({ error: null });
    (getSupabaseOTX as jest.Mock).mockReturnValue(makeSupaMock(upsertSpy, insertSpy));

    // Two identical SerpAPI results — should collapse to 1 unique row
    const dup = { link: 'https://dup.com', title: 'Dup', snippet: 'Same content' };
    global.fetch = jest.fn((url: string) => {
      const u = String(url);
      if (u.includes('serpapi.com') && u.includes('engine=google_trends')) return Promise.resolve({ ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) });
      if (u.includes('serpapi.com') && u.includes('hl=iw')) return Promise.resolve(makeSerpResponse([dup, dup]));
      if (u.includes('reddit.com')) return Promise.resolve({ ok: true, json: async () => ({ data: { children: [] } }) });
      if (u.includes('tavily.com')) return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
      if (u.includes('findplacefromtext')) return Promise.resolve({ ok: true, json: async () => ({ candidates: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as any;

    await collectOTXSignals();

    expect(upsertSpy).toHaveBeenCalled();
    const [rows] = upsertSpy.mock.calls[0];
    // The two identical results should be deduped to 1
    const serpRows = rows.filter((r: any) => r.source_url === 'https://dup.com');
    expect(serpRows.length).toBe(1);
  });

  test('one failing source does not abort remaining sources', async () => {
    const upsertSpy = jest.fn().mockResolvedValue({ error: null, count: 1 });
    const insertSpy = jest.fn().mockResolvedValue({ error: null });
    (getSupabaseOTX as jest.Mock).mockReturnValue(makeSupaMock(upsertSpy, insertSpy));

    const serpResult = { link: 'https://serp-ok.com', title: 'SerpOK', snippet: 'Works' };
    global.fetch = jest.fn((url: string) => {
      const u = String(url);
      if (u.includes('serpapi.com') && u.includes('engine=google_trends')) return Promise.resolve({ ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) });
      if (u.includes('serpapi.com') && u.includes('hl=iw')) return Promise.resolve(makeSerpResponse([serpResult]));
      // Reddit throws — simulates a network failure
      if (u.includes('reddit.com')) return Promise.reject(new Error('Reddit network failure'));
      if (u.includes('tavily.com')) return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
      if (u.includes('findplacefromtext')) return Promise.resolve({ ok: true, json: async () => ({ candidates: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as any;

    // Must not throw even though Reddit fails
    await expect(collectOTXSignals()).resolves.toBeUndefined();
    // SerpAPI result still made it through
    expect(upsertSpy).toHaveBeenCalled();
  });
});
