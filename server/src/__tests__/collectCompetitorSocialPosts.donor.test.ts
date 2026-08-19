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
  google_place_id: null, instagram_url: 'https://instagram.com/testco', facebook_url: null, tiktok_url: null,
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

// ─── No local URL yet (URL enrichment still in flight) — donor lookup should
// still be attempted via google_place_id, since that's set at creation time,
// well before the slower Tavily/DataForSEO URL enrichment finishes.

test('no local URL but has google_place_id -> still finds and clones from a donor', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: 'place1', instagram_url: null, facebook_url: null, tiktok_url: null,
  }]);
  // All 3 platforms produce donor-only tasks that run concurrently — use
  // implementation-based mocks (order-independent) rather than *Once queuing.
  queryRawUnsafe.mockImplementation(async (sql: string) =>
    sql.includes('GROUP BY competitor_id') ? [{ competitor_id: 'donor-1' }] : [],
  );
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(findDonorCandidates).toHaveBeenCalledWith('c1', 'b1', expect.objectContaining({ googlePlaceId: 'place1', urlValue: null }));
  expect(runApifyActor).not.toHaveBeenCalled();
  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeTruthy();
});

test('no local URL, has google_place_id, but no donor -> skips Apify entirely (no url to scrape)', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: 'place1', instagram_url: null, facebook_url: null, tiktok_url: null,
  }]);
  queryRawUnsafe.mockResolvedValue([]); // no existing posts, no fresh donor for any platform
  (findDonorCandidates as jest.Mock).mockResolvedValue([]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  const res = mockRes();
  await collectCompetitorSocialPosts(req, res);

  expect(runApifyActor).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ upserted: 0 }));
});

test('no local URL and no google_place_id -> skipped immediately, no donor lookup attempted', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{
    id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
    google_place_id: null, instagram_url: null, facebook_url: null, tiktok_url: null,
  }]);

  const req: any = { body: { businessProfileId: 'b1', force: true } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(findDonorCandidates).not.toHaveBeenCalled();
  expect(runApifyActor).not.toHaveBeenCalled();
});
