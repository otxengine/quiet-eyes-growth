/**
 * Unit tests — enrichCompetitorUrls (KAN-219)
 * Covers: AC7 (consume existing website_url), AC2 (site-extract call, not TTL-gated),
 *         AC5 (fill-if-empty — no overwrite), TTL stamp on success/soft-empty.
 * HTML-parsing behavior itself is covered by KAN-218's extractSocialLinksFromWebsite.test.ts.
 */

jest.mock('../db', () => ({
  prisma: {
    competitor: {
      findMany: jest.fn(),
      update:   jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../lib/extractSocialLinksFromWebsite', () => ({
  extractSocialLinksFromWebsite: jest.fn(),
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

// KAN-220: paid-tier fallback clients — default to "nothing found" so existing
// KAN-219/KAN-221 tests above keep their exact prior behavior unless a test opts in.
jest.mock('../lib/googlePlaces', () => ({ getPlaceDetails: jest.fn(async () => ({ websiteUri: '' })) }));
jest.mock('../lib/dataforseo', () => ({ searchOrganic: jest.fn(async () => ({ urls: [], costUsd: 0 })) }));
jest.mock('../lib/serpapi', () => ({ serpGoogleOrganic: jest.fn(async () => []) }));
jest.mock('../lib/tavily', () => ({ isTavilyRateLimited: jest.fn(() => false), tavilySearch: jest.fn(async () => []) }));

import { prisma } from '../db';
import { enrichCompetitorUrls, enrichCompetitorUrlsScheduled } from '../routes/functions/enrichCompetitorUrls';
import { extractSocialLinksFromWebsite } from '../lib/extractSocialLinksFromWebsite';
import { getPlaceDetails } from '../lib/googlePlaces';
import { searchOrganic } from '../lib/dataforseo';
import { serpGoogleOrganic } from '../lib/serpapi';
import { tavilySearch } from '../lib/tavily';

const EMPTY = { instagram_url: null, facebook_url: null };

beforeEach(() => {
  jest.clearAllMocks();
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue(EMPTY);
  (getPlaceDetails as jest.Mock).mockResolvedValue({ websiteUri: '' });
  (searchOrganic as jest.Mock).mockResolvedValue({ urls: [], costUsd: 0 });
  (serpGoogleOrganic as jest.Mock).mockResolvedValue([]);
  (tavilySearch as jest.Mock).mockResolvedValue([]);
});

test('AC7: skips a competitor with no website_url (nothing to consume)', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: null, instagram_url: null, facebook_url: null },
  ]);
  const result = await enrichCompetitorUrls(['c1']);
  expect(result).toEqual({ enriched: 0, skipped: 1 });
  expect(prisma.competitor.update).not.toHaveBeenCalled();
  expect(extractSocialLinksFromWebsite).not.toHaveBeenCalled();
});

test('AC2: calls extractSocialLinksFromWebsite and fills empty social fields, no staleness gate involved', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null },
  ]);
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue({
    instagram_url: 'https://www.instagram.com/mybiz/', facebook_url: 'https://facebook.com/mybiz',
  });

  const result = await enrichCompetitorUrls(['c1']);

  expect(extractSocialLinksFromWebsite).toHaveBeenCalledWith('https://biz.co.il');
  expect(result).toEqual({ enriched: 1, skipped: 0 });
  expect(prisma.competitor.update).toHaveBeenCalledWith({
    where: { id: 'c1' },
    data: expect.objectContaining({
      instagram_url: 'https://www.instagram.com/mybiz/',
      facebook_url:  'https://facebook.com/mybiz',
      social_pages_crawled_at: expect.any(String),
    }),
  });
});

test('AC5: never overwrites an already-set (manual or prior) social field', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'https://instagram.com/owner_set', facebook_url: null },
  ]);
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue({
    instagram_url: 'https://instagram.com/auto_found', facebook_url: 'https://facebook.com/auto_found',
  });

  await enrichCompetitorUrls(['c1']);

  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBeUndefined(); // untouched — was already set
  expect(updateData.facebook_url).toBe('https://facebook.com/auto_found'); // filled — was empty
});

test('skips a fully-populated competitor unless force is passed', async () => {
  const full = { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b' };
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([full]);

  const result = await enrichCompetitorUrls(['c1']);
  expect(result).toEqual({ enriched: 0, skipped: 1 });
  expect(prisma.competitor.update).not.toHaveBeenCalled();
  expect(extractSocialLinksFromWebsite).not.toHaveBeenCalled();
});

test('AC2 (force): re-runs extraction for a fully-populated competitor when force=true', async () => {
  const full = { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b' };
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([full]);

  const result = await enrichCompetitorUrls(['c1'], { force: true });
  expect(result).toEqual({ enriched: 1, skipped: 0 });
  expect(extractSocialLinksFromWebsite).toHaveBeenCalledWith('https://biz.co.il');
  // fill-if-empty still applies — nothing to fill since all fields were already set
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBeUndefined();
});

test('TTL stamp: social_pages_crawled_at is set even on soft-empty (extraction finds nothing)', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null },
  ]);
  // default mock already resolves EMPTY

  const result = await enrichCompetitorUrls(['c1']);
  expect(result).toEqual({ enriched: 1, skipped: 0 });
  expect(prisma.competitor.update).toHaveBeenCalledWith({
    where: { id: 'c1' },
    data: { social_pages_crawled_at: expect.any(String) },
  });
});

test('returns immediately for an empty id list without touching the db', async () => {
  const result = await enrichCompetitorUrls([]);
  expect(result).toEqual({ enriched: 0, skipped: 0 });
  expect(prisma.competitor.findMany).not.toHaveBeenCalled();
});

// ── KAN-220: ordered fallback (Places Details / DataForSEO → organic SERP → Tavily last) ──

test('AC3: Places Details fills a missing website_url when place_id is present', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: 'place123', website_url: null,
      instagram_url: 'a', facebook_url: 'b' },
  ]);
  (getPlaceDetails as jest.Mock).mockResolvedValue({ websiteUri: 'https://comp.co.il' });

  const result = await enrichCompetitorUrls(['c1']);

  expect(getPlaceDetails).toHaveBeenCalledWith('place123');
  expect(result).toEqual({ enriched: 1, skipped: 0 });
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.website_url).toBe('https://comp.co.il');
});

test('AC3/SERP transport: no place_id — DataForSEO organic fills website, SerpAPI not called', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: null, website_url: null,
      instagram_url: 'a', facebook_url: 'b' },
  ]);
  (searchOrganic as jest.Mock).mockResolvedValue({ urls: ['https://comp.co.il'], costUsd: 0.002 });

  await enrichCompetitorUrls(['c1']);

  expect(serpGoogleOrganic).not.toHaveBeenCalled();
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.website_url).toBe('https://comp.co.il');
});

test('SERP transport: DataForSEO organic empty — soft-fails to SerpAPI', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: null, website_url: null,
      instagram_url: 'a', facebook_url: 'b' },
  ]);
  (serpGoogleOrganic as jest.Mock).mockResolvedValue(['https://comp.co.il']);

  await enrichCompetitorUrls(['c1']);

  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.website_url).toBe('https://comp.co.il');
});

test('AC3/AC6: Places + organic SERP both empty — Tavily is the last resort for website', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: 'place123', website_url: null,
      instagram_url: 'a', facebook_url: 'b' },
  ]);
  (tavilySearch as jest.Mock).mockImplementation(async (q: string) =>
    q.includes('אתר') ? [{ url: 'https://tavily-found.co.il' }] : []);

  await enrichCompetitorUrls(['c1']);

  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.website_url).toBe('https://tavily-found.co.il');
});

test('AC4: organic SERP fills a social field still empty after site-extract', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: null, website_url: 'https://comp.co.il',
      instagram_url: null, facebook_url: 'b' },
  ]);
  (searchOrganic as jest.Mock).mockImplementation(async (q: string) =>
    q.includes('site:instagram.com') ? { urls: ['https://instagram.com/comp'], costUsd: 0 } : { urls: [], costUsd: 0 });

  await enrichCompetitorUrls(['c1']);

  expect(extractSocialLinksFromWebsite).toHaveBeenCalled(); // site-extract still ran first (KAN-219 primary)
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBe('https://instagram.com/comp');
});

test('AC6: site-extract already found a social field — organic SERP not spent on it', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: null, website_url: 'https://comp.co.il',
      instagram_url: null, facebook_url: null },
  ]);
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue({
    instagram_url: 'https://instagram.com/from-site', facebook_url: null,
  });

  await enrichCompetitorUrls(['c1']);

  const igCalls = (searchOrganic as jest.Mock).mock.calls.filter((c: any) => c[0].includes('site:instagram.com'));
  expect(igCalls).toHaveLength(0); // already filled by site-extract — no paid call spent
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBe('https://instagram.com/from-site');
});

test('AC5: paid-tier website fallback is skipped entirely once website_url is already set', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: 'place123', website_url: 'https://existing.co.il',
      instagram_url: 'a', facebook_url: 'b', rating: 4.5, review_count: 100 },
  ]);

  const result = await enrichCompetitorUrls(['c1']);

  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(searchOrganic).not.toHaveBeenCalled();
  expect(result).toEqual({ enriched: 0, skipped: 1 }); // nothing empty, nothing to do
});

test('rating/review_count backfill: fetched independently of website_url and fill-if-empty only', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: 'place123', website_url: 'https://existing.co.il',
      instagram_url: 'a', facebook_url: 'b', rating: null, review_count: null },
  ]);
  (getPlaceDetails as jest.Mock).mockResolvedValue({ websiteUri: '', rating: 4.2, reviewCount: 250 });

  const result = await enrichCompetitorUrls(['c1']);

  expect(getPlaceDetails).toHaveBeenCalledWith('place123');
  expect(prisma.competitor.update).toHaveBeenCalledWith({
    where: { id: 'c1' },
    data: expect.objectContaining({ rating: 4.2, review_count: 250 }),
  });
  expect(result).toEqual({ enriched: 1, skipped: 0 });
});

test('host validation rejects a malformed Places Details website', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'Comp', google_place_id: 'place123', website_url: null,
      instagram_url: 'a', facebook_url: 'b' },
  ]);
  (getPlaceDetails as jest.Mock).mockResolvedValue({ websiteUri: 'not-a-valid-url' });

  const result = await enrichCompetitorUrls(['c1']);

  expect(result).toEqual({ enriched: 0, skipped: 1 });
  expect(prisma.competitor.update).not.toHaveBeenCalled();
});

test('KAN-223 IL sampling: IL brand with no footer social falls through organic SERP for every platform', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'פיצה רומא', google_place_id: null, website_url: 'https://pizza-roma.co.il', address: 'תל אביב',
      instagram_url: null, facebook_url: null },
  ]);
  // site-extract found nothing on the site itself (no footer social) — default EMPTY mock applies
  (searchOrganic as jest.Mock).mockImplementation(async (q: string) => {
    if (q.includes('site:instagram.com')) return { urls: ['https://instagram.com/pizza_roma_il'], costUsd: 0 };
    if (q.includes('site:facebook.com'))  return { urls: ['https://facebook.com/pizzaromatlv'], costUsd: 0 };
    return { urls: [], costUsd: 0 };
  });

  await enrichCompetitorUrls(['c1']);

  expect(extractSocialLinksFromWebsite).toHaveBeenCalledWith('https://pizza-roma.co.il'); // site-extract tried first
  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBe('https://instagram.com/pizza_roma_il'); // SERP
  expect(updateData.facebook_url).toBe('https://facebook.com/pizzaromatlv');    // SERP
});

test('AC8: Apify is never imported/called by the URL discovery/enrichment pipeline', () => {
  const fs = require('fs');
  const files = [
    '../routes/functions/enrichCompetitorUrls',
    '../routes/functions/discoverCompetitorUrls',
    '../routes/functions/runCompetitorIdentification',
  ];
  for (const f of files) {
    const src = fs.readFileSync(require.resolve(f), 'utf8');
    expect(src.toLowerCase()).not.toContain('apify');
  }
});

describe('enrichCompetitorUrlsScheduled (KAN-221)', () => {
  const mkRes = () => {
    const json = jest.fn();
    return { json, status: jest.fn(() => ({ json })) } as any;
  };

  test('AC1/AC2: selects rivals with a website_url that are empty-or-stale, capped and ordered oldest-crawled-first, independent of last_scanned', async () => {
    (prisma.competitor.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'c1' }])
      .mockResolvedValueOnce([{ id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null }]);

    const res = mkRes();
    await enrichCompetitorUrlsScheduled({ body: { businessProfileId: 'biz1' } } as any, res);

    const selection = (prisma.competitor.findMany as jest.Mock).mock.calls[0][0];
    expect(selection.where.linked_business).toBe('biz1');
    expect(selection.where.website_url).toEqual({ not: null });
    expect(selection.where.OR).toEqual(expect.arrayContaining([
      { instagram_url: null }, { facebook_url: null }, { social_pages_crawled_at: null },
    ]));
    expect(selection.where).not.toHaveProperty('last_scanned');
    expect(selection.take).toBe(10);
    expect(selection.orderBy).toEqual({ social_pages_crawled_at: 'asc' });
    expect(res.json).toHaveBeenCalledWith({ enriched: 1, skipped: 0 });
  });

  test('AC3: a fully-populated, fresh rival never reaches the core (filtered out by the query itself)', async () => {
    (prisma.competitor.findMany as jest.Mock).mockResolvedValueOnce([]);

    const res = mkRes();
    await enrichCompetitorUrlsScheduled({ body: { businessProfileId: 'biz1' } } as any, res);

    expect(prisma.competitor.findMany).toHaveBeenCalledTimes(1); // selection only — nothing to enrich
    expect(res.json).toHaveBeenCalledWith({ enriched: 0, skipped: 0 });
  });

  test('force=true bypasses the empty/stale filter and re-runs the capped batch', async () => {
    (prisma.competitor.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'c1' }])
      .mockResolvedValueOnce([{ id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b' }]);

    const res = mkRes();
    await enrichCompetitorUrlsScheduled({ body: { businessProfileId: 'biz1', force: true } } as any, res);

    const selection = (prisma.competitor.findMany as jest.Mock).mock.calls[0][0];
    expect(selection.where.OR).toBeUndefined();
    expect(extractSocialLinksFromWebsite).toHaveBeenCalledWith('https://biz.co.il');
  });

  test('missing businessProfileId returns 400 without querying the db', async () => {
    const res = mkRes();
    await enrichCompetitorUrlsScheduled({ body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.competitor.findMany).not.toHaveBeenCalled();
  });
});
