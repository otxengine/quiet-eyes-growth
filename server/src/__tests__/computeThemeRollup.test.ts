import { computeThemeRollup, computeReviewTrend } from '../routes/functions/computeThemeRollup';
import { prisma } from '../db';

jest.mock('../db', () => ({ prisma: { $queryRawUnsafe: jest.fn() } }));
const mockQueryRaw = prisma.$queryRawUnsafe as jest.Mock;

describe('computeThemeRollup — KAN-124 AC1', () => {
  afterEach(() => jest.clearAllMocks());

  test('aggregates topic_sentiment counts per topic and polarity', async () => {
    mockQueryRaw.mockResolvedValue([
      { topic_sentiment: JSON.stringify({ שירות: 'positive', מחיר: 'neutral' }) },
      { topic_sentiment: JSON.stringify({ שירות: 'positive', אוכל: 'negative' }) },
      { topic_sentiment: JSON.stringify({ שירות: 'negative' }) },
    ]);

    const result = await computeThemeRollup('bp-1');

    const service = result.find(t => t.theme === 'שירות');
    expect(service).toMatchObject({ positive: 2, negative: 1, neutral: 0, total: 3 });

    const price = result.find(t => t.theme === 'מחיר');
    expect(price).toMatchObject({ positive: 0, negative: 0, neutral: 1, total: 1 });

    // sorted by total desc
    expect(result[0].theme).toBe('שירות');
  });

  test('skips rows with null or invalid topic_sentiment', async () => {
    mockQueryRaw.mockResolvedValue([
      { topic_sentiment: null },
      { topic_sentiment: 'not-json' },
      { topic_sentiment: JSON.stringify({ נושא: 'positive' }) },
    ]);

    const result = await computeThemeRollup('bp-2');
    expect(result).toHaveLength(1);
    expect(result[0].theme).toBe('נושא');
  });

  test('returns empty array when no reviews have topic_sentiment', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await computeThemeRollup('bp-3');
    expect(result).toEqual([]);
  });

  test('filters on created_at::timestamptz, not created_date', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await computeThemeRollup('bp-4');
    const sql = mockQueryRaw.mock.calls[0][0];
    expect(sql).toContain('created_at::timestamptz');
    expect(sql).not.toContain('created_date');
  });

  test('platformFilter=google includes dataforseo_google_reviews in the source_origin filter', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await computeThemeRollup('bp-5', 90, 'google');
    const [sql, , , sourceOrigins] = mockQueryRaw.mock.calls[0];
    expect(sql).toContain('source_origin = ANY');
    expect(sourceOrigins).toContain('dataforseo_google_reviews');
  });

  test('queries by linked_competitor when linkedCompetitorId is given', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await computeThemeRollup('bp-6', 90, undefined, 'comp-1');
    const [sql, param1] = mockQueryRaw.mock.calls[0];
    expect(sql).toContain('linked_competitor = $1');
    expect(param1).toBe('comp-1');
  });
});

describe('computeReviewTrend', () => {
  afterEach(() => jest.clearAllMocks());

  // Regression test: computeReviewTrend used to fetch `take: 200` unordered rows and
  // filter in JS — on a business with hundreds of reviews spanning years, that could
  // grab an arbitrary subset missing the real recent rows entirely, wrongly returning
  // null. Aggregating in SQL means the counts/avgs are always over the FULL matching
  // set, not a capped sample.
  test('returns improving when recent avg rating is higher than prior', async () => {
    mockQueryRaw.mockResolvedValue([
      { recent_count: 8, recent_avg: 4.8, prior_count: 14, prior_avg: 4.2 },
    ]);
    const trend = await computeReviewTrend({ linked_business: 'bp-1' });
    expect(trend).toBe('improving');
  });

  test('returns declining when recent avg rating is lower than prior', async () => {
    mockQueryRaw.mockResolvedValue([
      { recent_count: 5, recent_avg: 3.0, prior_count: 6, prior_avg: 4.5 },
    ]);
    const trend = await computeReviewTrend({ linked_business: 'bp-2' });
    expect(trend).toBe('declining');
  });

  test('returns stable when the delta is within the noise threshold', async () => {
    mockQueryRaw.mockResolvedValue([
      { recent_count: 5, recent_avg: 4.5, prior_count: 5, prior_avg: 4.45 },
    ]);
    const trend = await computeReviewTrend({ linked_business: 'bp-3' });
    expect(trend).toBe('stable');
  });

  test('returns null when either window has fewer than 3 reviews', async () => {
    mockQueryRaw.mockResolvedValue([
      { recent_count: 2, recent_avg: 5, prior_count: 10, prior_avg: 4 },
    ]);
    const trend = await computeReviewTrend({ linked_business: 'bp-4' });
    expect(trend).toBeNull();
  });

  test('queries by linked_competitor column when given a competitor filter', async () => {
    mockQueryRaw.mockResolvedValue([{ recent_count: 0, recent_avg: null, prior_count: 0, prior_avg: null }]);
    await computeReviewTrend({ linked_competitor: 'comp-1' });
    const [sql, param1] = mockQueryRaw.mock.calls[0];
    expect(sql).toContain('linked_competitor = $1');
    expect(param1).toBe('comp-1');
  });
});
