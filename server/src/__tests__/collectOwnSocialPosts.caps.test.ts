/**
 * Unit tests — collectOwnSocialPosts caps/cursor fixes.
 * Covers: TikTok actor call now receives oldestPostDateUnified when a cursor
 * exists (was previously dead — TikTok ignored history entirely); a
 * future-dated posted_at value never becomes the "since" cursor, so one bad
 * timestamp can't silently freeze collection.
 */

const businessPostFindMany = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    businessPost: {
      findMany: (...args: any[]) => businessPostFindMany(...args),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'new-1' })),
    },
  },
}));

jest.mock('../lib/apify', () => ({
  hasApifyKey: jest.fn(() => true),
  runApifyActor: jest.fn(async () => []),
}));

jest.mock('../lib/s3', () => ({ isS3Configured: jest.fn(() => false), uploadImageFromUrl: jest.fn() }));
jest.mock('../lib/analyzePostCreative', () => ({ analyzePostCreative: jest.fn(async () => null) }));
jest.mock('../lib/agentCache', () => ({ shouldSkipAgent: jest.fn(() => false), setLastRun: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { collectOwnSocialPosts } from '../routes/functions/collectOwnSocialPosts';

const mockRunApifyActor = runApifyActor as jest.Mock;

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunApifyActor.mockResolvedValue([]);
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1', instagram_url: null, facebook_url: null, tiktok_url: 'https://tiktok.com/@biz',
  });
});

test('TikTok call includes oldestPostDateUnified when a cursor exists', async () => {
  businessPostFindMany.mockResolvedValue([
    { id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img', video_url: null, analyzed_at: new Date(), video_analyzed_at: null, posted_at: new Date('2026-01-01T00:00:00Z') },
  ]);

  await collectOwnSocialPosts({ body: { businessProfileId: 'b1', force: true } } as any, mockRes());

  const tiktokCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'clockworks~tiktok-profile-scraper');
  expect(tiktokCall).toBeTruthy();
  expect(tiktokCall![1]).toMatchObject({ oldestPostDateUnified: '2026-01-01' });
});

test('a future-dated posted_at is never used as the cursor', async () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  businessPostFindMany.mockResolvedValue([
    { id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img', video_url: null, analyzed_at: new Date(), video_analyzed_at: null, posted_at: future },
  ]);

  await collectOwnSocialPosts({ body: { businessProfileId: 'b1', force: true } } as any, mockRes());

  const tiktokCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'clockworks~tiktok-profile-scraper');
  expect(tiktokCall![1]).not.toHaveProperty('oldestPostDateUnified');
});

test('first-ever scrape (no cursor) uses the deeper backfill cap', async () => {
  businessPostFindMany.mockResolvedValue([]); // no existing posts -> no cursor yet

  await collectOwnSocialPosts({ body: { businessProfileId: 'b1', force: true } } as any, mockRes());

  const tiktokCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'clockworks~tiktok-profile-scraper');
  expect(tiktokCall![1]).toMatchObject({ resultsPerPage: 150 });
  expect(tiktokCall![1]).not.toHaveProperty('oldestPostDateUnified');
});

test('repeat scrape (cursor exists) uses the steady-state cap, not the backfill cap', async () => {
  businessPostFindMany.mockResolvedValue([
    { id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img', video_url: null, analyzed_at: new Date(), video_analyzed_at: null, posted_at: new Date('2026-01-01T00:00:00Z') },
  ]);

  await collectOwnSocialPosts({ body: { businessProfileId: 'b1', force: true } } as any, mockRes());

  const tiktokCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'clockworks~tiktok-profile-scraper');
  expect(tiktokCall![1]).toMatchObject({ resultsPerPage: 5 });
});
