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

import { prisma } from '../db';
import { enrichCompetitorUrls } from '../routes/functions/enrichCompetitorUrls';
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
