/**
 * Unit tests — collectCompetitorSocialPosts Facebook actor call.
 * Covers: the actor call uses resultsLimit (the actor's actual input schema
 * property) instead of the unrecognized maxPosts param, which previously made
 * Apify silently ignore our cap and default to a single unpaginated page; and
 * that fullBackfill bypasses an existing cursor to force a real re-backfill.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/apify', () => ({
  hasApifyKey: jest.fn(() => true),
  runApifyActor: jest.fn(),
}));

jest.mock('../lib/s3', () => ({ isS3Configured: jest.fn(() => false), uploadImageFromUrl: jest.fn() }));
jest.mock('../lib/analyzePostCreative', () => ({ analyzePostCreative: jest.fn(async () => null) }));
jest.mock('../lib/agentCache', () => ({ shouldSkipAgent: jest.fn(() => false), setLastRun: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { collectCompetitorSocialPosts } from '../routes/functions/collectCompetitorSocialPosts';

const COMP = { id: 'c1', name: 'אב-גד', not_relevant: false, tracking_status: 'approved', instagram_url: null, facebook_url: 'https://facebook.com/avgadgroup', tiktok_url: null };

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function fbCall() {
  return (runApifyActor as jest.Mock).mock.calls.find(([actorId]) => actorId === 'apify~facebook-posts-scraper');
}

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(undefined);
  (runApifyActor as jest.Mock).mockResolvedValue([]);
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
});

test('first-ever scrape uses resultsLimit (backfill cap), not the unrecognized maxPosts param', async () => {
  queryRawUnsafe.mockResolvedValueOnce([]); // no existing rows -> no cursor yet

  await collectCompetitorSocialPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  expect(fbCall()).toBeTruthy();
  expect(fbCall()![1]).toMatchObject({ resultsLimit: 75 });
  expect(fbCall()![1]).not.toHaveProperty('maxPosts');
  expect(fbCall()![1]).not.toHaveProperty('maxPostComments');
});

test('repeat scrape (cursor exists) uses the steady-state resultsLimit cap', async () => {
  queryRawUnsafe.mockResolvedValueOnce([
    { id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img', video_url: null, analyzed_at: null, video_analyzed_at: null, posted_at: '2026-01-01T00:00:00.000Z' },
  ]);

  await collectCompetitorSocialPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  expect(fbCall()![1]).toMatchObject({ resultsLimit: 5, onlyPostsNewerThan: '2026-01-01' });
});

test('fullBackfill bypasses an existing cursor and re-requests the backfill cap', async () => {
  queryRawUnsafe.mockResolvedValueOnce([
    { id: 'p1', external_post_id: 'x1', post_url: null, content_hash: null, media_url: 'http://img', video_url: null, analyzed_at: null, video_analyzed_at: null, posted_at: '2026-01-01T00:00:00.000Z' },
  ]);

  await collectCompetitorSocialPosts({ body: { businessProfileId: 'b1', fullBackfill: true } } as any, mockRes());

  expect(fbCall()![1]).toMatchObject({ resultsLimit: 75 });
  expect(fbCall()![1]).not.toHaveProperty('onlyPostsNewerThan');
});
