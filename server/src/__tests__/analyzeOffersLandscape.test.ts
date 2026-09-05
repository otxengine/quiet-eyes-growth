/**
 * Unit tests — analyzeOffersLandscape: 48h cache-hit path, force-bypass path,
 * and the zero-competitor edge case. DB and LLM calls are mocked.
 */

const queryRawUnsafe = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    competitor: { findMany: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
  },
}));

jest.mock('../lib/synthesizeOffersLandscape', () => ({
  synthesizeOffersLandscape: jest.fn(),
}));

import { prisma } from '../db';
import { synthesizeOffersLandscape } from '../lib/synthesizeOffersLandscape';
import { analyzeOffersLandscape } from '../routes/functions/analyzeOffersLandscape';

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('cache-hit path: fresh insight within 48h returns cached without recomputing', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    offers_landscape_insight: 'תובנה קיימת',
    offers_landscape_stats: JSON.stringify({ total_offers: 3 }),
    offers_landscape_examples: JSON.stringify([{ competitorName: 'מתחרה א', offer_details: 'הנחה 20%', date: '2024-01-01' }]),
    offers_landscape_insight_at: new Date().toISOString(), // just computed, well within 48h
  });

  const req: any = { body: { businessProfileId: 'bp-1' } };
  const res = mockRes();
  await analyzeOffersLandscape(req, res);

  expect(prisma.competitor.findMany).not.toHaveBeenCalled();
  expect(queryRawUnsafe).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({
    insight: 'תובנה קיימת',
    stats: { total_offers: 3 },
    examples: [{ competitorName: 'מתחרה א', offer_details: 'הנחה 20%', date: '2024-01-01' }],
    cached: true,
  });
});

test('force bypasses a fresh cache and recomputes', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    offers_landscape_insight: 'ישן',
    offers_landscape_stats: JSON.stringify({ total_offers: 1 }),
    offers_landscape_insight_at: new Date().toISOString(),
  });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
    { id: 'c1', name: 'מתחרה א' },
    { id: 'c2', name: 'מתחרה ב' },
  ]);
  queryRawUnsafe
    .mockResolvedValueOnce([ // posts
      { competitor_id: 'c1', posted_at: new Date(), likes: 100, comments_count: 10, analysis: JSON.stringify({ has_offer: true, offer_mechanic: 'discount', offer_details: 'הנחה 20%' }) },
    ])
    .mockResolvedValueOnce([]); // ads
  (synthesizeOffersLandscape as jest.Mock).mockResolvedValue('נרטיב חדש');

  const req: any = { body: { businessProfileId: 'bp-1', force: true } };
  const res = mockRes();
  await analyzeOffersLandscape(req, res);

  expect(prisma.competitor.findMany).toHaveBeenCalled();
  expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
  expect(synthesizeOffersLandscape).toHaveBeenCalled();
  expect(prisma.businessProfile.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'bp-1' },
    data: expect.objectContaining({ offers_landscape_insight: 'נרטיב חדש' }),
  }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    insight: 'נרטיב חדש',
    cached: false,
    examples: [expect.objectContaining({ competitorName: 'מתחרה א', offer_details: 'הנחה 20%' })],
  }));
});

test('zero-competitor edge case returns a null result without throwing', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    offers_landscape_insight: null,
    offers_landscape_stats: null,
    offers_landscape_insight_at: null,
  });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([]);

  const req: any = { body: { businessProfileId: 'bp-2' } };
  const res = mockRes();
  await analyzeOffersLandscape(req, res);

  expect(queryRawUnsafe).not.toHaveBeenCalled();
  expect(synthesizeOffersLandscape).not.toHaveBeenCalled();
  expect(prisma.businessProfile.update).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ insight: null, stats: null, examples: [], cached: false });
  expect(res.status).not.toHaveBeenCalledWith(500);
});

test('stale cache (>48h) recomputes even without force', async () => {
  const staleDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    offers_landscape_insight: 'ישן',
    offers_landscape_stats: JSON.stringify({ total_offers: 1 }),
    offers_landscape_insight_at: staleDate,
  });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([{ id: 'c1', name: 'מתחרה א' }]);
  queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // no analyzed items at all

  const req: any = { body: { businessProfileId: 'bp-3' } };
  const res = mockRes();
  await analyzeOffersLandscape(req, res);

  expect(prisma.competitor.findMany).toHaveBeenCalled();
  expect(synthesizeOffersLandscape).not.toHaveBeenCalled(); // no offer data -> skip LLM call
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    insight: null,
    cached: false,
    stats: expect.objectContaining({ competitors_total: 1, competitors_with_active_offer: 0, active_offer_pct: 0 }),
  }));
});
