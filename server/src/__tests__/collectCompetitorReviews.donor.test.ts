/**
 * Unit tests — collectCompetitorReviews cross-business donor cache.
 * Covers: fresh donor found -> clones reviews, never calls SerpAPI/DataForSEO/
 * Places/topic-extraction; no fresh donor -> falls through to a normal fetch.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    competitor: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    review: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    dataForSeoReviewTask: { create: jest.fn().mockResolvedValue({}) },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/googlePlaces', () => ({ findPlaceId: jest.fn(), getPlaceDetails: jest.fn(async () => ({ reviews: [] })) }));
jest.mock('../lib/signalGuard', () => ({ normReviewOrigin: jest.fn(() => 'google_places') }));
jest.mock('../lib/serpapi', () => ({ serpGoogleMapsReviews: jest.fn(async () => []), firstValidDate: jest.fn(() => null) }));
jest.mock('../lib/dataforseo', () => ({ submitGoogleReviewsTask: jest.fn(), hasDataForSeoCreds: jest.fn(() => false) }));
jest.mock('../lib/reviewTaxonomy', () => ({ batchExtractTopics: jest.fn(async () => []) }));
jest.mock('../lib/businessProfile', () => ({ getSectorProfile: jest.fn(() => ({ sector_key: 'other', onboarding_review_extras: [] })) }));
jest.mock('../lib/reviewTopicPacks', () => ({ resolveTopicSet: jest.fn(() => []) }));
jest.mock('../lib/reviewPostProcessing', () => ({ backfillTopicsFor: jest.fn(async () => {}) }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn() }));

import { prisma } from '../db';
import { serpGoogleMapsReviews } from '../lib/serpapi';
import { submitGoogleReviewsTask } from '../lib/dataforseo';
import { getPlaceDetails } from '../lib/googlePlaces';
import { batchExtractTopics } from '../lib/reviewTaxonomy';
import { findDonorCandidates } from '../lib/competitorDonor';
import { runCollectCompetitorReviews } from '../routes/functions/collectCompetitorReviews';

const COMP = { id: 'c1', name: 'Test Co', google_place_id: 'place1' };

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(0);
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue({ id: 'b1', name: 'My Biz', city: 'TLV' });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
  (prisma.review.findMany as jest.Mock).mockResolvedValue([]);
});

test('fresh donor found -> clones reviews and never calls SerpAPI/DataForSEO/Places/topics', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([{ competitor_id: 'donor-1' }]); // freshness check
  executeRawUnsafe.mockResolvedValueOnce(5); // 5 reviews cloned

  const result = await runCollectCompetitorReviews('b1');

  expect(serpGoogleMapsReviews).not.toHaveBeenCalled();
  expect(submitGoogleReviewsTask).not.toHaveBeenCalled();
  expect(getPlaceDetails).not.toHaveBeenCalled();
  expect(batchExtractTopics).not.toHaveBeenCalled();
  expect(result.total_new).toBe(5);
  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeTruthy();
});

test('no fresh donor -> falls through to a normal SerpAPI fetch', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([]); // no donor fresh enough
  (serpGoogleMapsReviews as jest.Mock).mockResolvedValueOnce([]);

  await runCollectCompetitorReviews('b1');

  expect(serpGoogleMapsReviews).toHaveBeenCalled();
});

test('no donor candidates at all -> skips the freshness query and scrapes normally', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([]);
  (serpGoogleMapsReviews as jest.Mock).mockResolvedValueOnce([]);

  await runCollectCompetitorReviews('b1');

  expect(queryRawUnsafe).not.toHaveBeenCalled();
  expect(serpGoogleMapsReviews).toHaveBeenCalled();
});
