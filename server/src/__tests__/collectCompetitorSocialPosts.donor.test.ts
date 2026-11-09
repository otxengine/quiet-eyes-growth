/**
 * Unit tests — collectCompetitorSocialPosts cross-business donor cache.
 * Covers: fresh donor found -> clones posts, skips Apify entirely; no fresh
 * donor -> falls through to a normal Apify scrape; force=true still checks
 * for a donor (force only bypasses the per-business ran-recently throttle,
 * not the donor cache — this matters for onboarding's initial force:true
 * population, which is exactly when cross-business sharing helps most).
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

// Plan gating is covered by planLimits.test.ts; this file tests what the collector does once it runs.
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

// google_place_id is null here so these single-platform tests only produce one
// task (instagram) — tests further below cover the google_place_id fallback
// that also enqueues donor-only attempts for platforms with no local URL.
const COMP = {
  id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
  google_place_id: null, instagram_url: 'https://instagram.com/testco', facebook_url: null,
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

test('force=true still checks for and uses a fresh donor (bypasses only the ran-recently throttle)', async () => {
  queryRawUnsafe
    .mockResolvedValueOnce([])                       // existing posts for this competitor: none yet
    .mockResolvedValueOnce([{ competitor_id: 'donor-1' }]); // freshness check: donor has recent posts
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(findDonorCandidates).toHaveBeenCalled();
  expect(runApifyActor).not.toHaveBeenCalled();
});

test('force=true with no fresh donor still scrapes fresh via Apify', async () => {
  queryRawUnsafe
    .mockResolvedValueOnce([]) // existing posts
    .mockResolvedValueOnce([]); // freshness check: no donor fresh enough
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(runApifyActor).toHaveBeenCalled();
});

// ─── No URL on the competitor — never scrape or clone posts for that platform,
// even when a google_place_id donor exists: the donor's posts belong to the
// donor's own (possibly wrong) URL, which this competitor never approved.

test('no local URL but has google_place_id + fresh donor -> no donor lookup, no clone, no Apify', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: 'place1', instagram_url: null, facebook_url: null,
  }]);
  queryRawUnsafe.mockImplementation(async (sql: string) =>
    sql.includes('GROUP BY competitor_id') ? [{ competitor_id: 'donor-1' }] : [],
  );
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  const res = mockRes();
  await collectCompetitorSocialPosts(req, res);

  expect(findDonorCandidates).not.toHaveBeenCalled();
  expect(runApifyActor).not.toHaveBeenCalled();
  expect(executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'))).toBeUndefined();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ upserted: 0 }));
});

test('only facebook_url set -> instagram is skipped as no_url, facebook still runs', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: 'place1', instagram_url: null, facebook_url: 'https://facebook.com/testco',
  }]);
  queryRawUnsafe.mockResolvedValue([]);
  (findDonorCandidates as jest.Mock).mockResolvedValue([]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  const res = mockRes();
  await collectCompetitorSocialPosts(req, res);

  expect(findDonorCandidates).toHaveBeenCalledTimes(1);
  expect(findDonorCandidates).toHaveBeenCalledWith('c1', 'b1', expect.objectContaining({ platform: 'facebook' }));
  const { diagnostics } = res.json.mock.calls[0][0];
  expect(diagnostics).toContainEqual(expect.objectContaining({ platform: 'instagram', reason: 'no_url' }));
});

test('no local URL and no google_place_id -> skipped immediately, no donor lookup attempted', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: null, instagram_url: null, facebook_url: null,
  }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(findDonorCandidates).not.toHaveBeenCalled();
  expect(runApifyActor).not.toHaveBeenCalled();
});
