/**
 * KAN-160 — Dedicated URL discovery: independent of snapshot, ±city queries, confidence overwrite.
 */
import { discoverCompetitorUrls } from '../routes/functions/discoverCompetitorUrls';

const STALE_DATE = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago → stale
const FRESH_DATE = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago  → skip

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === 'missing') return null;
        return { id: 'biz1', name: 'TestBiz', city: 'תל אביב', category: 'מסעדות' };
      }),
    },
    competitor: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
  },
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

jest.mock('../lib/tavily', () => ({
  isTavilyRateLimited: jest.fn(() => false),
  tavilySearch: jest.fn(async () => []),
}));

function makeReq(body: object) { return { body } as any; }
function makeRes() {
  const r: any = {};
  r.status = jest.fn(() => r);
  r.json   = jest.fn(() => r);
  return r;
}

const { prisma } = require('../db');

let mockTavily: jest.Mock;
let mockUpdate: jest.Mock;

beforeEach(() => {
  const tavily = require('../lib/tavily');
  mockTavily = tavily.tavilySearch as jest.Mock;
  mockTavily.mockReset().mockResolvedValue([]);
  const { prisma: db } = require('../db');
  mockUpdate = db.competitor.update as jest.Mock;
  mockUpdate.mockClear();
});

// ── AC: validation ────────────────────────────────────────────────────────────

test('returns 400 when businessProfileId missing', async () => {
  const res = makeRes();
  await discoverCompetitorUrls(makeReq({}), res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test('returns 404 when profile not found', async () => {
  const res = makeRes();
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'missing' }), res);
  expect(res.status).toHaveBeenCalledWith(404);
});

// ── AC4: staleness guard uses social_pages_crawled_at, not last_scanned ──────

test('skips competitor crawled within 7 days, processes stale ones', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'fresh', name: 'Fresh', social_pages_crawled_at: FRESH_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
    { id: 'stale', name: 'Stale', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  const res = makeRes();
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), res);

  // Only stale competitor triggered an update
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect((mockUpdate.mock.calls as any)[0][0].where.id).toBe('stale');
});

test('processes competitor with null social_pages_crawled_at (never crawled)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'never', name: 'Never', social_pages_crawled_at: null, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  const res = makeRes();
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), res);

  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

// ── AC1: site: queries fire regardless of website_url being null ──────────────

test('fires 8 Tavily queries even when all URL fields are null (AC1)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'NoWeb', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());

  expect(mockTavily).toHaveBeenCalledTimes(8);
  const queries = mockTavily.mock.calls.map((c: any) => c[0] as string);
  expect(queries.some(q => q.includes('site:instagram.com'))).toBe(true);
  expect(queries.some(q => q.includes('site:facebook.com'))).toBe(true);
  expect(queries.some(q => q.includes('site:tiktok.com'))).toBe(true);
});

// ── AC2: ±city queries — both with-city and without-city fire ─────────────────

test('fires both with-city and without-city queries for each platform (AC2)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'TestComp', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());

  const queries = mockTavily.mock.calls.map((c: any) => c[0] as string);
  // Instagram: one with city, one without
  expect(queries.filter(q => q.includes('site:instagram.com'))).toHaveLength(2);
  expect(queries.filter(q => q.includes('site:facebook.com'))).toHaveLength(2);
  expect(queries.filter(q => q.includes('site:tiktok.com'))).toHaveLength(2);
  // One with-city query must include the city, one must not
  const igQueries = queries.filter(q => q.includes('site:instagram.com'));
  expect(igQueries.some(q => q.includes('תל אביב'))).toBe(true);
  expect(igQueries.some(q => !q.includes('תל אביב'))).toBe(true);
});

// ── AC3: low confidence fills empty only; high confidence overwrites ───────────

test('low confidence: fills empty field, does not overwrite existing (AC3)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/existing', facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  // Only with-city finds IG URL (→ low confidence); without-city finds nothing
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com') && query.includes('תל אביב'))
      return [{ url: 'https://instagram.com/newhandle' }];
    return [];
  });

  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());

  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  // Low confidence → should NOT overwrite existing instagram_url
  expect(updateArg.instagram_url).toBeUndefined();
});

test('high confidence: overwrites existing URL when both variants agree (AC3)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/old', facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  // Both with-city AND without-city return the same URL → high confidence
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com'))
      return [{ url: 'https://instagram.com/confirmed' }];
    return [];
  });

  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());

  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  // High confidence → overwrites
  expect(updateArg.instagram_url).toBe('https://instagram.com/confirmed');
});

// ── AC2: canonical field names ─────────────────────────────────────────────────

test('saves to canonical field names (AC2)', async () => {
  prisma.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);

  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com')) return [{ url: 'https://instagram.com/foo' }];
    if (query.includes('site:facebook.com'))  return [{ url: 'https://facebook.com/foo' }];
    if (query.includes('site:tiktok.com'))    return [{ url: 'https://tiktok.com/@foo' }];
    return [];
  });

  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());

  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg).toHaveProperty('instagram_url');
  expect(updateArg).toHaveProperty('facebook_url');
  expect(updateArg).toHaveProperty('tiktok_url');
  expect(updateArg).toHaveProperty('social_pages_crawled_at');
});
