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

import { prisma } from '../db';
import { enrichCompetitorUrls, enrichCompetitorUrlsScheduled } from '../routes/functions/enrichCompetitorUrls';
import { extractSocialLinksFromWebsite } from '../lib/extractSocialLinksFromWebsite';

const EMPTY = { instagram_url: null, facebook_url: null, tiktok_url: null };

beforeEach(() => {
  jest.clearAllMocks();
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue(EMPTY);
});

test('AC7: skips a competitor with no website_url (nothing to consume)', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: null, instagram_url: null, facebook_url: null, tiktok_url: null },
  ]);
  const result = await enrichCompetitorUrls(['c1']);
  expect(result).toEqual({ enriched: 0, skipped: 1 });
  expect(prisma.competitor.update).not.toHaveBeenCalled();
  expect(extractSocialLinksFromWebsite).not.toHaveBeenCalled();
});

test('AC2: calls extractSocialLinksFromWebsite and fills empty social fields, no staleness gate involved', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null, tiktok_url: null },
  ]);
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue({
    instagram_url: 'https://www.instagram.com/mybiz/', facebook_url: 'https://facebook.com/mybiz', tiktok_url: null,
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
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'https://instagram.com/owner_set', facebook_url: null, tiktok_url: 'https://tiktok.com/@owner_set' },
  ]);
  (extractSocialLinksFromWebsite as jest.Mock).mockResolvedValue({
    instagram_url: 'https://instagram.com/auto_found', facebook_url: 'https://facebook.com/auto_found', tiktok_url: 'https://tiktok.com/@auto_found',
  });

  await enrichCompetitorUrls(['c1']);

  const updateData = (prisma.competitor.update as jest.Mock).mock.calls[0][0].data;
  expect(updateData.instagram_url).toBeUndefined(); // untouched — was already set
  expect(updateData.tiktok_url).toBeUndefined();     // untouched — was already set
  expect(updateData.facebook_url).toBe('https://facebook.com/auto_found'); // filled — was empty
});

test('skips a fully-populated competitor unless force is passed', async () => {
  const full = { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b', tiktok_url: 'c' };
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([full]);

  const result = await enrichCompetitorUrls(['c1']);
  expect(result).toEqual({ enriched: 0, skipped: 1 });
  expect(prisma.competitor.update).not.toHaveBeenCalled();
  expect(extractSocialLinksFromWebsite).not.toHaveBeenCalled();
});

test('AC2 (force): re-runs extraction for a fully-populated competitor when force=true', async () => {
  const full = { id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b', tiktok_url: 'c' };
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
    { id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null, tiktok_url: null },
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

describe('enrichCompetitorUrlsScheduled (KAN-221)', () => {
  const mkRes = () => {
    const json = jest.fn();
    return { json, status: jest.fn(() => ({ json })) } as any;
  };

  test('AC1/AC2: selects rivals with a website_url that are empty-or-stale, capped and ordered oldest-crawled-first, independent of last_scanned', async () => {
    (prisma.competitor.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'c1' }])
      .mockResolvedValueOnce([{ id: 'c1', website_url: 'https://biz.co.il', instagram_url: null, facebook_url: null, tiktok_url: null }]);

    const res = mkRes();
    await enrichCompetitorUrlsScheduled({ body: { businessProfileId: 'biz1' } } as any, res);

    const selection = (prisma.competitor.findMany as jest.Mock).mock.calls[0][0];
    expect(selection.where.linked_business).toBe('biz1');
    expect(selection.where.website_url).toEqual({ not: null });
    expect(selection.where.OR).toEqual(expect.arrayContaining([
      { instagram_url: null }, { facebook_url: null }, { tiktok_url: null }, { social_pages_crawled_at: null },
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
      .mockResolvedValueOnce([{ id: 'c1', website_url: 'https://biz.co.il', instagram_url: 'a', facebook_url: 'b', tiktok_url: 'c' }]);

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
