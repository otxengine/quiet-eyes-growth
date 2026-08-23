import { compareGoogleMetrics } from '../routes/functions/compareGoogleMetrics';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    competitor:      { findMany: jest.fn() },
  },
}));

jest.mock('../routes/functions/computeThemeRollup', () => ({
  computeThemeRollup: jest.fn().mockResolvedValue([]),
}));

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockProfile = { id: 'bp1', google_rating: 4.0, google_review_count: 100 };

beforeEach(() => jest.clearAllMocks());

describe('compareGoogleMetrics — KAN-140', () => {
  it('AC1: returns volume-weighted aggregate, not flat mean, when volumes differ', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    // c1: 4.0★ × 1000 reviews, c2: 3.0★ × 10 reviews
    // weighted = (4000 + 30) / 1010 ≈ 3.99; flat mean = 3.5
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: 4.0, review_count: 1000 },
      { id: 'c2', name: 'B', rating: 3.0, review_count: 10 },
    ]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.market).not.toBeNull();
    expect(body.market.rating).toBeCloseTo(4030 / 1010, 5);
    expect(body.market.rating).not.toBeCloseTo(3.5, 1); // definitely not flat mean
  });

  it('AC2: excludes competitors with null rating or zero review_count', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: 4.0, review_count: 200 },
      { id: 'c2', name: 'B', rating: null, review_count: 50 },  // null rating
      { id: 'c3', name: 'C', rating: 3.0, review_count: 0 },    // zero reviews
    ]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    // Only c1 contributes: rating=4.0, total_reviews=200
    expect(body.market.rating).toBeCloseTo(4.0);
    expect(body.market.total_reviews).toBe(200);
  });

  it('AC2: returns null market when all competitors are excluded', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: null, review_count: 100 },
      { id: 'c2', name: 'B', rating: 4.0, review_count: 0 },
    ]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.market).toBeNull();
    expect(body.delta).toBeNull();
  });

  it('AC3: passes competitorIds filter to DB query', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: 3.5, review_count: 80 },
    ]);

    const req: any = { body: { businessProfileId: 'bp1', competitorIds: ['c1'] } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    expect(prisma.competitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['c1'] } }) }),
    );
    const body = res.json.mock.calls[0][0];
    expect(body.market.rating).toBeCloseTo(3.5);
    expect(body.market.total_reviews).toBe(80);
  });

  it('AC4: response includes own rating/count, market aggregate, total_reviews, and delta', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    // own=4.0, market weighted = (3.0×100 + 5.0×100)/200 = 4.0 → delta=0
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: 3.0, review_count: 100 },
      { id: 'c2', name: 'B', rating: 5.0, review_count: 100 },
    ]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.own.google_rating).toBe(4.0);
    expect(body.own.review_count).toBe(100);
    expect(body.market.rating).toBeCloseTo(4.0);
    expect(body.market.total_reviews).toBe(200);
    expect(body.delta).toBeCloseTo(0.0);
    expect(typeof body.market.low_confidence).toBe('boolean');
  });

  it('low_confidence is true when market total_reviews < 50', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(mockProfile);
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', name: 'A', rating: 4.2, review_count: 10 },
    ]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);

    expect(res.json.mock.calls[0][0].market.low_confidence).toBe(true);
  });

  it('returns 400 when businessProfileId is missing', async () => {
    const req: any = { body: {} };
    const res = mockRes();
    await compareGoogleMetrics(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when business profile not found', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.competitor.findMany as jest.Mock).mockResolvedValue([]);

    const req: any = { body: { businessProfileId: 'missing' } };
    const res = mockRes();
    await compareGoogleMetrics(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
