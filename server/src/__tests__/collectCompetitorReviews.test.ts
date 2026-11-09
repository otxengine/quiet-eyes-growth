/**
 * KAN-121 — Competitor review ingest: DataForSEO is the only review source.
 * This function only submits one DataForSEO task per competitor. The rows themselves are written by the
 * webhook (linked_competitor set, response_status null) — covered in dataforseoWebhook.test.ts.
 */
import { collectCompetitorReviews } from '../routes/functions/collectCompetitorReviews';
import { prisma } from '../db';
import { submitGoogleReviewsTask } from '../lib/dataforseo';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn(async () => ({ id: 'biz1', city: 'תל אביב', name: 'Biz' })) },
    competitor: {
      findMany: jest.fn(async () => [{ id: 'comp1', name: 'Rival', google_place_id: 'ChIJrival' }]),
      update:   jest.fn(async () => ({})),
    },
    review: { findMany: jest.fn(async () => []), createMany: jest.fn(), create: jest.fn() },
    dataForSeoReviewTask: { create: jest.fn(async () => ({})) },
  },
}));
jest.mock('../lib/dataforseo', () => ({
  submitGoogleReviewsTask: jest.fn(async () => ({ taskId: 'task-1', costUsd: 0.0375 })),
  hasDataForSeoCreds: jest.fn(() => true),
}));
jest.mock('../lib/googlePlaces', () => ({ findPlaceId: jest.fn(async () => null) }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/reviewPostProcessing', () => ({ backfillTopicsFor: jest.fn(async () => {}) }));
// Donor cache is covered in collectCompetitorReviews.donor.test.ts — force "no donor" here.
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const run = (res = makeRes()) => collectCompetitorReviews({ body: { businessProfileId: 'biz1' } } as any, res).then(() => res);

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, DATAFORSEO_REVIEWS_ENABLED: 'true' };
});
afterAll(() => { process.env = OLD_ENV; });

test('submits one DataForSEO task per competitor, recorded against that competitor', async () => {
  const res = await run();
  expect(submitGoogleReviewsTask).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'ChIJrival', tag: 'comp1' }));
  expect(prisma.dataForSeoReviewTask.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ task_id: 'task-1', task_type: 'competitor', business_profile_id: 'biz1', linked_competitor: 'comp1' }),
  });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dataforseo_tasks_submitted: 1 }));
});

test('never writes reviews itself — the DataForSEO webhook does', async () => {
  await run();
  expect(prisma.review.createMany).not.toHaveBeenCalled();
  expect(prisma.review.create).not.toHaveBeenCalled();
});

test('DataForSEO switched off: no task and no other source is tried', async () => {
  process.env.DATAFORSEO_REVIEWS_ENABLED = 'false';
  const res = await run();
  expect(submitGoogleReviewsTask).not.toHaveBeenCalled();
  expect(prisma.review.createMany).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dataforseo_tasks_submitted: 0 }));
});
