/**
 * analyzeOwnReviewInsights — Reviews pillar (Insights page), own-business scope.
 * Tests the cache-hit / force-bypass / zero-reviews contract; computeThemeRollup and the
 * LLM narrative call are mocked so no DB/network is needed.
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    review: { findMany: jest.fn() },
  },
}));

jest.mock('../routes/functions/computeThemeRollup', () => ({
  computeThemeRollup: jest.fn(),
}));

jest.mock('../lib/synthesizeReviewThemeInsight', () => ({
  synthesizeReviewThemeInsight: jest.fn(),
}));

import { prisma } from '../db';
import { computeThemeRollup } from '../routes/functions/computeThemeRollup';
import { synthesizeReviewThemeInsight } from '../lib/synthesizeReviewThemeInsight';
import { analyzeOwnReviewInsights } from '../routes/functions/analyzeOwnReviewInsights';

const mockFindUnique = prisma.businessProfile.findUnique as jest.Mock;
const mockUpdate = prisma.businessProfile.update as jest.Mock;
const mockReviewFindMany = prisma.review.findMany as jest.Mock;
const mockComputeThemeRollup = computeThemeRollup as jest.Mock;
const mockSynthesize = synthesizeReviewThemeInsight as jest.Mock;

function makeReq(body: object) { return { body } as any; }
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReviewFindMany.mockResolvedValue([]);
});

test('cache hit: returns cached insight within 48h without calling computeThemeRollup', async () => {
  mockFindUnique.mockResolvedValue({
    own_reviews_pillar_insight: 'תובנה שמורה',
    own_reviews_pillar_examples: JSON.stringify([{ theme: 'שירות', polarity: 'positive', text: 'מעולה' }]),
    own_reviews_pillar_insight_at: new Date().toISOString(),
  });

  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({ businessProfileId: 'bp-1' }), res);

  expect(computeThemeRollup).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insight: 'תובנה שמורה', cached: true }));
});

test('force bypasses a fresh cache and recomputes', async () => {
  mockFindUnique.mockResolvedValue({
    own_reviews_pillar_insight: 'ישן',
    own_reviews_pillar_examples: null,
    own_reviews_pillar_insight_at: new Date().toISOString(),
  });
  mockComputeThemeRollup.mockResolvedValue([
    { theme: 'שירות', positive: 5, negative: 1, neutral: 0, total: 6 },
  ]);
  mockSynthesize.mockResolvedValue('תובנה חדשה');

  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({ businessProfileId: 'bp-1', force: true }), res);

  expect(computeThemeRollup).toHaveBeenCalledWith('bp-1', 90);
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'bp-1' },
    data: expect.objectContaining({ own_reviews_pillar_insight: 'תובנה חדשה' }),
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insight: 'תובנה חדשה', cached: false }));
});

test('stale cache (older than 48h) recomputes even without force', async () => {
  const stale = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  mockFindUnique.mockResolvedValue({
    own_reviews_pillar_insight: 'ישן',
    own_reviews_pillar_examples: null,
    own_reviews_pillar_insight_at: stale,
  });
  mockComputeThemeRollup.mockResolvedValue([
    { theme: 'מחיר', positive: 1, negative: 4, neutral: 0, total: 5 },
  ]);
  mockSynthesize.mockResolvedValue('תובנה מעודכנת');

  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({ businessProfileId: 'bp-1' }), res);

  expect(computeThemeRollup).toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insight: 'תובנה מעודכנת', cached: false }));
});

test('zero reviews: returns null insight gracefully without throwing or writing to DB', async () => {
  mockFindUnique.mockResolvedValue({
    own_reviews_pillar_insight: null,
    own_reviews_pillar_examples: null,
    own_reviews_pillar_insight_at: null,
  });
  mockComputeThemeRollup.mockResolvedValue([]);

  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({ businessProfileId: 'bp-2' }), res);

  expect(synthesizeReviewThemeInsight).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ insight: null, examples: [], cached: false });
});

test('missing businessProfileId returns 400', async () => {
  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({}), res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test('unknown businessProfileId returns 404', async () => {
  mockFindUnique.mockResolvedValue(null);
  const res = makeRes();
  await analyzeOwnReviewInsights(makeReq({ businessProfileId: 'nope' }), res);
  expect(res.status).toHaveBeenCalledWith(404);
});
