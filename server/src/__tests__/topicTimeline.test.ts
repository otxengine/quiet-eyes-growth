import { topicTimeline } from '../routes/functions/topicTimeline';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    review: { findMany: jest.fn() },
  },
}));

const mockCompetitor = prisma.competitor.findMany as jest.Mock;
const mockReview = prisma.review.findMany as jest.Mock;

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('topicTimeline — KAN-146', () => {
  beforeEach(() => jest.clearAllMocks());

  test('AC0: returns 400 if no businessProfileId', async () => {
    const res = makeRes();
    await topicTimeline({ body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('AC1: buckets own reviews by quarter with correct polarity counts', async () => {
    mockCompetitor.mockResolvedValue([]);
    // KAN-153: quarterly buckets — 2024-03-04 → 2024-Q1
    const d = new Date('2024-03-04T10:00:00Z');
    mockReview.mockResolvedValueOnce([
      { topic_sentiment: JSON.stringify({ שירות: 'positive' }), created_date: d },
      { topic_sentiment: JSON.stringify({ שירות: 'positive', מחיר: 'negative' }), created_date: d },
    ]);

    const res = makeRes();
    await topicTimeline({ body: { businessProfileId: 'bp-1' } } as any, res);

    const data = res.json.mock.calls[0][0];
    const service = data.own.find((s: any) => s.topic_id === 'שירות');
    expect(service?.buckets[0]).toMatchObject({ period: '2024-Q1', positive: 2, negative: 0 });
    const price = data.own.find((s: any) => s.topic_id === 'מחיר');
    expect(price?.buckets[0]).toMatchObject({ period: '2024-Q1', positive: 0, negative: 1 });
  });

  test('AC2+AC3: zero-fills missing periods across own and competitor', async () => {
    mockCompetitor.mockResolvedValue([{ id: 'c1', name: 'Rival' }]);
    const q1 = new Date('2024-03-04T00:00:00Z'); // → 2024-Q1
    const q2 = new Date('2024-04-08T00:00:00Z'); // → 2024-Q2
    // own has Q1, competitor has Q2 — both series must have 2 buckets
    mockReview
      .mockResolvedValueOnce([{ topic_sentiment: JSON.stringify({ שירות: 'positive' }), created_date: q1 }])
      .mockResolvedValueOnce([{ topic_sentiment: JSON.stringify({ שירות: 'negative' }), created_date: q2 }]);

    const res = makeRes();
    await topicTimeline({ body: { businessProfileId: 'bp-1' } } as any, res);

    const data = res.json.mock.calls[0][0];
    const ownService = data.own.find((s: any) => s.topic_id === 'שירות');
    expect(ownService.buckets).toHaveLength(2);
    const ownQ2 = ownService.buckets.find((b: any) => b.period === '2024-Q2');
    expect(ownQ2).toMatchObject({ positive: 0, negative: 0 }); // zero-filled

    const compService = data.competitors[0].series.find((s: any) => s.topic_id === 'שירות');
    expect(compService.buckets).toHaveLength(2);
    const compQ1 = compService.buckets.find((b: any) => b.period === '2024-Q1');
    expect(compQ1).toMatchObject({ positive: 0, negative: 0 }); // zero-filled
  });

  test('AC4: skips null/invalid topic_sentiment without throwing', async () => {
    mockCompetitor.mockResolvedValue([]);
    mockReview.mockResolvedValueOnce([
      { topic_sentiment: null, created_date: new Date() },
      { topic_sentiment: 'not-json', created_date: new Date() },
      { topic_sentiment: JSON.stringify({ שירות: 'positive' }), created_date: new Date() },
    ]);

    const res = makeRes();
    await topicTimeline({ body: { businessProfileId: 'bp-1' } } as any, res);

    const data = res.json.mock.calls[0][0];
    expect(data.own).toHaveLength(1);
    expect(data.own[0].topic_id).toBe('שירות');
  });
});
