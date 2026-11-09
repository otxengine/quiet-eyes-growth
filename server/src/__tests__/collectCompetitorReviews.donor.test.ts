/**
 * Unit tests — collectCompetitorReviews cross-business donor cache.
 * Covers: fresh donor found -> clones reviews and never pays for a DataForSEO task;
 * no fresh donor -> falls through to a normal DataForSEO task.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    competitor: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    review: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    dataForSeoReviewTask: { create: jest.fn().mockResolvedValue({}) },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/googlePlaces', () => ({ findPlaceId: jest.fn() }));
jest.mock('../lib/dataforseo', () => ({
  submitGoogleReviewsTask: jest.fn(async () => ({ taskId: 'task-1', costUsd: 0 })),
  hasDataForSeoCreds: jest.fn(() => true),
}));
jest.mock('../lib/businessProfile', () => ({ getSectorProfile: jest.fn(() => ({ sector_key: 'other', onboarding_review_extras: [] })) }));
jest.mock('../lib/reviewTopicPacks', () => ({ resolveTopicSet: jest.fn(() => []) }));
jest.mock('../lib/reviewPostProcessing', () => ({ backfillTopicsFor: jest.fn(async () => {}) }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn() }));

import { prisma } from '../db';
import { submitGoogleReviewsTask } from '../lib/dataforseo';
import { findDonorCandidates } from '../lib/competitorDonor';
import { runCollectCompetitorReviews } from '../routes/functions/collectCompetitorReviews';

const COMP = { id: 'c1', name: 'Test Co', google_place_id: 'place1' };
const OLD_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, DATAFORSEO_REVIEWS_ENABLED: 'true' };
  executeRawUnsafe.mockResolvedValue(0);
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue({ id: 'b1', name: 'My Biz', city: 'TLV' });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
  (prisma.review.findMany as jest.Mock).mockResolvedValue([]);
});
afterAll(() => { process.env = OLD_ENV; });

test('fresh donor found -> clones reviews and never submits a DataForSEO task', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([{ competitor_id: 'donor-1' }]); // freshness check
  executeRawUnsafe.mockResolvedValueOnce(5); // 5 reviews cloned

  const result = await runCollectCompetitorReviews('b1');

  expect(submitGoogleReviewsTask).not.toHaveBeenCalled();
  expect(result.total_new).toBe(5);
  const cloneSql = String(executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'))?.[0]);
  expect(cloneSql).toContain('length(d.text) >= 5'); // star-only reviews ('' text) are deduped by id, not text
});

test('no fresh donor -> falls through to a DataForSEO task', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([]); // no donor fresh enough

  await runCollectCompetitorReviews('b1');

  expect(submitGoogleReviewsTask).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'place1', tag: 'c1' }));
});

test('no donor candidates at all -> skips the freshness query and submits a DataForSEO task', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([]);

  await runCollectCompetitorReviews('b1');

  expect(queryRawUnsafe).not.toHaveBeenCalled();
  expect(submitGoogleReviewsTask).toHaveBeenCalled();
});
