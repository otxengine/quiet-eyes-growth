/**
 * KAN-160 — Dedicated URL discovery: independent of snapshot, ±city/±EN queries, confidence overwrite.
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
// Default: no EN name (LLM returns null) so query count stays predictable in most tests
jest.mock('../lib/llm', () => ({
  invokeLLM: jest.fn(async () => ({ en: null })),
}));

function makeReq(body: object) { return { body } as any; }
function makeRes() {
  const r: any = {};
  r.status = jest.fn(() => r);
  r.json   = jest.fn(() => r);
  return r;
}

let mockTavily: jest.Mock;
let mockUpdate: jest.Mock;
let mockLLM: jest.Mock;

beforeEach(() => {
  mockTavily = require('../lib/tavily').tavilySearch as jest.Mock;
  mockTavily.mockReset().mockResolvedValue([]);
  mockUpdate = (require('../db').prisma as any).competitor.update as jest.Mock;
  mockUpdate.mockClear();
  mockLLM = require('../lib/llm').invokeLLM as jest.Mock;
  mockLLM.mockReset().mockResolvedValue({ en: null }); // no EN name by default
});

// ── Validation ────────────────────────────────────────────────────────────────

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

test('skips recently crawled competitor, processes stale one', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'fresh', name: 'Fresh', social_pages_crawled_at: FRESH_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
    { id: 'stale', name: 'Stale', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect((mockUpdate.mock.calls as any)[0][0].where.id).toBe('stale');
});

test('processes competitor with null social_pages_crawled_at (never crawled)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'never', name: 'Never', social_pages_crawled_at: null, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

// ── AC1: site: queries fire regardless of website_url ─────────────────────────

test('fires site: queries even when all URL fields are null (AC1)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'NoWeb', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const queries: string[] = mockTavily.mock.calls.map((c: any) => c[0]);
  expect(queries.some(q => q.includes('site:instagram.com'))).toBe(true);
  expect(queries.some(q => q.includes('site:facebook.com'))).toBe(true);
  expect(queries.some(q => q.includes('site:tiktok.com'))).toBe(true);
});

// ── AC2: ±city — both with-city and without-city fire ─────────────────────────

test('fires with-city and without-city queries for each platform (AC2)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'TestComp', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const queries: string[] = mockTavily.mock.calls.map((c: any) => c[0]);
  const igQ = queries.filter(q => q.includes('site:instagram.com'));
  expect(igQ.length).toBeGreaterThanOrEqual(2);
  expect(igQ.some(q => q.includes('תל אביב'))).toBe(true);
  expect(igQ.some(q => !q.includes('תל אביב'))).toBe(true);
});

// ── EN name: adds ±city × EN queries when LLM returns a transliteration ───────

test('adds EN+city and EN queries when LLM returns English name', async () => {
  mockLLM.mockResolvedValue({ en: 'CafeAmor' });
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'קפה אמור', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const queries: string[] = mockTavily.mock.calls.map((c: any) => c[0]);
  // Should have queries containing the English name
  expect(queries.some(q => q.includes('CafeAmor'))).toBe(true);
  // With city
  expect(queries.some(q => q.includes('CafeAmor') && q.includes('תל אביב'))).toBe(true);
  // Without city
  expect(queries.some(q => q.includes('CafeAmor') && !q.includes('תל אביב'))).toBe(true);
  // 4 IG variants: HE+city, HE, EN+city, EN
  expect(queries.filter(q => q.includes('site:instagram.com'))).toHaveLength(4);
});

test('skips EN queries when name is already Latin', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Pizza Roma', social_pages_crawled_at: STALE_DATE, instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  // LLM should NOT be called for a Latin name
  expect(mockLLM).not.toHaveBeenCalled();
  // Only 2 IG queries (HE+city, HE — but name is Latin)
  const queries: string[] = mockTavily.mock.calls.map((c: any) => c[0]);
  expect(queries.filter(q => q.includes('site:instagram.com'))).toHaveLength(2);
});

// ── AC3: low confidence fills empty only; high confidence overwrites ───────────

test('low confidence: does not overwrite existing URL (AC3)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/existing', facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  // Only one variant returns a result → low confidence
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com') && query.includes('תל אביב'))
      return [{ url: 'https://instagram.com/newhandle' }];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.instagram_url).toBeUndefined();
});

test('high confidence: overwrites existing URL when 2+ variants agree (AC3)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/old', facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  // All IG variants return the same URL (handle matches business name 'Comp') → high confidence
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com'))
      return [{ url: 'https://instagram.com/comp' }];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.instagram_url).toBe('https://instagram.com/comp');
});

// ── KAN-222: manual edits are protected from high-confidence overwrite ────────

test('high confidence: does NOT overwrite a manually-set URL without force', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/manual', facebook_url: null, tiktok_url: null, website_url: null,
      manual_url_fields: ['instagram_url'] },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com')) return [{ url: 'https://instagram.com/comp' }];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.instagram_url).toBeUndefined();
});

test('high confidence: overwrites a manually-set URL when force=true', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: 'https://instagram.com/manual', facebook_url: null, tiktok_url: null, website_url: null,
      manual_url_fields: ['instagram_url'] },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com')) return [{ url: 'https://instagram.com/comp' }];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1', force: true }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.instagram_url).toBe('https://instagram.com/comp');
});

// ── Profile-URL filter: posts/reels/videos are rejected ───────────────────────

test('ignores Instagram post/reel URLs, keeps profile URLs only', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Cafe Amor', social_pages_crawled_at: STALE_DATE,
      instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com')) return [
      { url: 'https://instagram.com/p/ABC123/' },        // post — rejected
      { url: 'https://instagram.com/reel/XYZ/' },        // reel — rejected
      { url: 'https://instagram.com/cafeamor/' },        // profile, handle matches 'cafe' — kept
    ];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.instagram_url).toBe('https://instagram.com/cafeamor/');
});

test('ignores TikTok video URLs, keeps profile URLs only', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Cafe Amor', social_pages_crawled_at: STALE_DATE,
      instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:tiktok.com')) return [
      { url: 'https://tiktok.com/@cafeamor/video/123456' }, // video — rejected
      { url: 'https://tiktok.com/@cafeamor' },              // profile, handle matches 'cafe' — kept
    ];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.tiktok_url).toBe('https://tiktok.com/@cafeamor');
});

test('rejects TikTok profile belonging to a reviewer, not the business', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Cafe Amor', social_pages_crawled_at: STALE_DATE,
      instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:tiktok.com'))
      return [{ url: 'https://tiktok.com/@israelifoodreviewer' }]; // reviewer — handle doesn't match
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg.tiktok_url).toBeUndefined();
});

// ── AC2: canonical field names ─────────────────────────────────────────────────

test('saves to canonical field names (AC2)', async () => {
  const { prisma: db } = require('../db');
  db.competitor.findMany.mockResolvedValueOnce([
    { id: 'c1', name: 'Comp', social_pages_crawled_at: STALE_DATE,
      instagram_url: null, facebook_url: null, tiktok_url: null, website_url: null },
  ]);
  mockTavily.mockImplementation(async (query: any) => {
    if (query.includes('site:instagram.com')) return [{ url: 'https://instagram.com/comp' }];
    if (query.includes('site:facebook.com'))  return [{ url: 'https://facebook.com/comp' }];
    if (query.includes('site:tiktok.com'))    return [{ url: 'https://tiktok.com/@comp' }];
    return [];
  });
  await discoverCompetitorUrls(makeReq({ businessProfileId: 'biz1' }), makeRes());
  const updateArg = (mockUpdate.mock.calls as any)[0][0].data;
  expect(updateArg).toHaveProperty('instagram_url');
  expect(updateArg).toHaveProperty('facebook_url');
  expect(updateArg).toHaveProperty('tiktok_url');
  expect(updateArg).toHaveProperty('social_pages_crawled_at');
});
