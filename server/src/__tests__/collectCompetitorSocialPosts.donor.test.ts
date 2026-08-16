/**
 * Unit tests — collectCompetitorSocialPosts cross-business donor cache.
 * Covers: fresh donor found -> clones posts, skips Apify entirely; no fresh
 * donor -> falls through to a normal Apify scrape; force=true -> always
 * scrapes fresh, never checks for a donor.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/apify', () => ({
  hasApifyKey: jest.fn(() => true),
  runApifyActor: jest.fn(async () => []),
}));

jest.mock('../lib/s3', () => ({
  isS3Configured: jest.fn(() => false),
  uploadImageFromUrl: jest.fn(),
}));

jest.mock('../lib/analyzePostCreative', () => ({
  analyzePostCreative: jest.fn(async () => null),
}));

jest.mock('../lib/agentCache', () => ({
  shouldSkipAgent: jest.fn(() => false),
  setLastRun: jest.fn(),
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn() }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { findDonorCandidates } from '../lib/competitorDonor';
import { collectCompetitorSocialPosts } from '../routes/functions/collectCompetitorSocialPosts';

const COMP = {
  id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
  google_place_id: 'place1', instagram_url: 'https://instagram.com/testco', facebook_url: null, tiktok_url: null,
};

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

test('fresh donor found -> clones posts and never calls Apify', async () => {
  queryRawUnsafe
    .mockResolvedValueOnce([])                       // existing posts for this competitor: none yet
    .mockResolvedValueOnce([{ competitor_id: 'donor-1' }]); // freshness check: donor has recent posts
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(runApifyActor).not.toHaveBeenCalled();
  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeTruthy();
});

test('no fresh donor -> falls through to a normal Apify scrape', async () => {
  queryRawUnsafe
    .mockResolvedValueOnce([]) // existing posts
    .mockResolvedValueOnce([]); // freshness check: no donor fresh enough
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(runApifyActor).toHaveBeenCalled();
});

test('force=true skips the donor lookup entirely and always scrapes fresh', async () => {
  queryRawUnsafe.mockResolvedValueOnce([]); // existing posts only — no freshness-check call expected

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(findDonorCandidates).not.toHaveBeenCalled();
  expect(runApifyActor).toHaveBeenCalled();
});
