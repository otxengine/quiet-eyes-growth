/**
 * Unit tests — collectCompetitorSocialPosts engagement refresh.
 * Covers: a post from the last 7 days widens the Apify window to today-7d at
 * REFRESH_CAP, overrides a postsDeltaSignal skip, and writes fresh likes/comments
 * onto the already-stored row; the donor-clone path also copies donor counts.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

// Plan gating is covered by planLimits.test.ts; this file tests the collector once it runs.
jest.mock('../lib/planLimits', () => ({
  socialGate: jest.fn().mockResolvedValue({ limits: {}, skip: null }),
  socialCompetitors: (competitors: any[]) => competitors,
}));

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/apify', () => ({ hasApifyKey: jest.fn(() => true), runApifyActor: jest.fn() }));
jest.mock('../lib/s3', () => ({ isS3Configured: jest.fn(() => false), uploadImageFromUrl: jest.fn() }));
jest.mock('../lib/analyzePostCreative', () => ({ analyzePostCreative: jest.fn(async () => null) }));
jest.mock('../lib/agentCache', () => ({ shouldSkipAgent: jest.fn(() => false), setLastRun: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { findDonorCandidates } from '../lib/competitorDonor';
import { collectCompetitorSocialPosts } from '../routes/functions/collectCompetitorSocialPosts';

const COMP = { id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved', instagram_url: null, facebook_url: 'https://facebook.com/testco' };
const DAY = 86_400_000;

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(0);
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
});

test('recent post -> 7d window at REFRESH_CAP, ignores skip signal, refreshes likes/comments', async () => {
  const recent = new Date(Date.now() - 2 * DAY).toISOString();
  queryRawUnsafe.mockResolvedValueOnce([{
    id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img',
    video_url: null, analyzed_at: recent, video_analyzed_at: null, posted_at: recent,
  }]);
  (runApifyActor as jest.Mock).mockResolvedValueOnce([{ id: 'x1', likes: 42, comments: 7 }]);

  await collectCompetitorSocialPosts({ body: {
    businessProfileId: 'b1', competitorPlatformOverrides: { c1: { facebook: { kind: 'skip' } } },
  } } as any, mockRes());

  const fb = (runApifyActor as jest.Mock).mock.calls.find(([a]) => a === 'apify~facebook-posts-scraper');
  expect(fb![1]).toMatchObject({ resultsLimit: 30, onlyPostsNewerThan: new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10) });

  const upd = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('likes = COALESCE($7::int'));
  expect(upd![1]).toBe('p1');
  expect(upd![7]).toBe(42);
  expect(upd![8]).toBe(7);
});

test('donor clone also copies donor likes/comments onto already-held recent posts', async () => {
  queryRawUnsafe
    .mockResolvedValueOnce([])                               // existing posts
    .mockResolvedValueOnce([{ competitor_id: 'donor-1' }]); // fresh donor
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  await collectCompetitorSocialPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const refresh = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('SET likes = d.likes'));
  expect(refresh![0]).toContain("interval '7 days'");
  expect(refresh!.slice(1)).toEqual(['c1', 'donor-1', 'facebook']);
  expect(runApifyActor).not.toHaveBeenCalled();
});
