/**
 * analyzeCompetitorReviewInsightsPooled — Reviews pillar (Insights page), pooled across
 * ALL tracked competitors. Tests the cache-hit / force-bypass / zero-tracked-competitors
 * contract plus the pooling/merge math across 2+ mocked competitors. computeThemeRollup
 * is called once per competitor (real function, mocked here) and merged in this handler —
 * the merge arithmetic itself is exercised, not just mocked away.
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    competitor: { findMany: jest.fn() },
    review: { findMany: jest.fn() },
  },
}));

jest.mock('../routes/functions/computeThemeRollup', () => ({
  computeThemeRollup: jest.fn(),
  REVIEWS_INSIGHTS_WINDOW_DAYS: 365,
}));

jest.mock('../lib/synthesizeReviewThemeInsight', () => ({
  synthesizeReviewThemeInsight: jest.fn(),
}));

import { prisma } from '../db';
import { computeThemeRollup } from '../routes/functions/computeThemeRollup';
import { synthesizeReviewThemeInsight } from '../lib/synthesizeReviewThemeInsight';
import { analyzeCompetitorReviewInsightsPooled } from '../routes/functions/analyzeCompetitorReviewInsightsPooled';

const mockFindUnique = prisma.businessProfile.findUnique as jest.Mock;
const mockUpdate = prisma.businessProfile.update as jest.Mock;
const mockCompetitorFindMany = prisma.competitor.findMany as jest.Mock;
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

test('cache hit: returns cached insight within 48h without fetching competitors', async () => {
  mockFindUnique.mockResolvedValue({
    competitor_reviews_pillar_insight: 'תובנה שמורה',
    competitor_reviews_pillar_stats: JSON.stringify([{ theme: 'שירות', positive: 3, negative: 1, neutral: 0, total: 4, competitors_mentioning: 2 }]),
    competitor_reviews_pillar_insight_at: new Date().toISOString(),
  });

  const res = makeRes();
  await analyzeCompetitorReviewInsightsPooled(makeReq({ businessProfileId: 'bp-1' }), res);

  expect(mockCompetitorFindMany).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insight: 'תובנה שמורה', cached: true }));
});

test('force bypasses a fresh cache and pools across 2 competitors with correct merge math', async () => {
  mockFindUnique.mockResolvedValue({
    competitor_reviews_pillar_insight: 'ישן',
    competitor_reviews_pillar_stats: null,
    competitor_reviews_pillar_insight_at: new Date().toISOString(),
  });
  mockCompetitorFindMany.mockResolvedValue([
    { id: 'c1', name: 'Rival A' },
    { id: 'c2', name: 'Rival B' },
  ]);

  // c1: שירות positive-heavy + מחיר negative; c2: שירות positive + a theme unique to c2 (איכות)
  mockComputeThemeRollup.mockImplementation(async (_bp: string, _win: number, _plat: string, competitorId: string) => {
    if (competitorId === 'c1') {
      return [
        { theme: 'שירות', positive: 5, negative: 1, neutral: 0, total: 6 },
        { theme: 'מחיר', positive: 0, negative: 3, neutral: 0, total: 3 },
      ];
    }
    return [
      { theme: 'שירות', positive: 2, negative: 0, neutral: 1, total: 3 },
      { theme: 'איכות', positive: 4, negative: 0, neutral: 0, total: 4 },
    ];
  });
  mockSynthesize.mockResolvedValue('תובנה משותפת');

  const res = makeRes();
  await analyzeCompetitorReviewInsightsPooled(makeReq({ businessProfileId: 'bp-1', force: true }), res);

  expect(mockComputeThemeRollup).toHaveBeenCalledWith('bp-1', 365, 'google', 'c1');
  expect(mockComputeThemeRollup).toHaveBeenCalledWith('bp-1', 365, 'google', 'c2');

  const jsonArg = res.json.mock.calls[0][0];
  const stats: any[] = jsonArg.stats;

  const service = stats.find(t => t.theme === 'שירות');
  expect(service).toMatchObject({ positive: 7, negative: 1, neutral: 1, total: 9, competitors_mentioning: 2 });

  const price = stats.find(t => t.theme === 'מחיר');
  expect(price).toMatchObject({ positive: 0, negative: 3, neutral: 0, total: 3, competitors_mentioning: 1 });

  const quality = stats.find(t => t.theme === 'איכות');
  expect(quality).toMatchObject({ positive: 4, negative: 0, neutral: 0, total: 4, competitors_mentioning: 1 });

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'bp-1' },
    data: expect.objectContaining({ competitor_reviews_pillar_insight: 'תובנה משותפת' }),
  }));
  expect(jsonArg.insight).toBe('תובנה משותפת');
  expect(jsonArg.cached).toBe(false);
});

test('zero tracked competitors: returns null insight gracefully without throwing or writing to DB', async () => {
  mockFindUnique.mockResolvedValue({
    competitor_reviews_pillar_insight: null,
    competitor_reviews_pillar_stats: null,
    competitor_reviews_pillar_insight_at: null,
  });
  mockCompetitorFindMany.mockResolvedValue([]);

  const res = makeRes();
  await analyzeCompetitorReviewInsightsPooled(makeReq({ businessProfileId: 'bp-2' }), res);

  expect(computeThemeRollup).not.toHaveBeenCalled();
  expect(synthesizeReviewThemeInsight).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ insight: null, stats: [], cached: false });
});

test('missing businessProfileId returns 400', async () => {
  const res = makeRes();
  await analyzeCompetitorReviewInsightsPooled(makeReq({}), res);
  expect(res.status).toHaveBeenCalledWith(400);
});
