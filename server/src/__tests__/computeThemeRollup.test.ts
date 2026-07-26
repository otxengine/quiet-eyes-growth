import { computeThemeRollup } from '../routes/functions/computeThemeRollup';
import { prisma } from '../db';

jest.mock('../db', () => ({ prisma: { review: { findMany: jest.fn() } } }));
const mockFindMany = prisma.review.findMany as jest.Mock;

describe('computeThemeRollup — KAN-124 AC1', () => {
  afterEach(() => jest.clearAllMocks());

  test('aggregates topic_sentiment counts per topic and polarity', async () => {
    mockFindMany.mockResolvedValue([
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
    mockFindMany.mockResolvedValue([
      { topic_sentiment: null },
      { topic_sentiment: 'not-json' },
      { topic_sentiment: JSON.stringify({ נושא: 'positive' }) },
    ]);

    const result = await computeThemeRollup('bp-2');
    expect(result).toHaveLength(1);
    expect(result[0].theme).toBe('נושא');
  });

  test('returns empty array when no reviews have topic_sentiment', async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await computeThemeRollup('bp-3');
    expect(result).toEqual([]);
  });
});
