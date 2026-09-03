import { computeEntityKpis } from '../lib/socialKpis';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: {
    businessSocialProfile: { findMany: jest.fn() },
    competitorSocialProfile: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

const mockBusinessFindMany = prisma.businessSocialProfile.findMany as jest.Mock;
const mockCompetitorFindMany = prisma.competitorSocialProfile.findMany as jest.Mock;
const mockQueryRaw = prisma.$queryRawUnsafe as jest.Mock;

describe('computeEntityKpis', () => {
  afterEach(() => jest.clearAllMocks());

  test('followers_gained_30d is null when no baseline snapshot exists', async () => {
    mockBusinessFindMany.mockResolvedValue([{ platform: 'instagram', follower_count: 500 }]);
    mockQueryRaw
      .mockResolvedValueOnce([]) // baseline snapshot query — none found
      .mockResolvedValueOnce([{ post_count: 0, total_likes: 0, total_comments: 0 }]);

    const result = await computeEntityKpis({ linked_business: 'bp-1', competitor_id: null });

    expect(result.followers).toBe(500);
    expect(result.followers_gained_30d).toBeNull();
  });

  test('followers_gained_30d sums deltas only across platforms present in both current and baseline', async () => {
    mockBusinessFindMany.mockResolvedValue([
      { platform: 'instagram', follower_count: 520 },
      { platform: 'facebook', follower_count: 300 }, // no baseline for this one — must be excluded
    ]);
    mockQueryRaw
      .mockResolvedValueOnce([{ platform_key: 'instagram', metric_value: 500 }])
      .mockResolvedValueOnce([{ post_count: 0, total_likes: 0, total_comments: 0 }]);

    const result = await computeEntityKpis({ linked_business: 'bp-1', competitor_id: null });

    expect(result.followers).toBe(820);
    expect(result.followers_gained_30d).toBe(20); // 520 - 500, facebook excluded (no baseline)
  });

  test('engagement_rate_30d is null when there are no posts in the window', async () => {
    mockCompetitorFindMany.mockResolvedValue([{ platform: 'instagram', follower_count: 1000 }]);
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ post_count: 0, total_likes: 0, total_comments: 0 }]);

    const result = await computeEntityKpis({ linked_business: 'bp-1', competitor_id: 'c1' });

    expect(result.avg_interactions_30d).toBeNull();
    expect(result.engagement_rate_30d).toBeNull();
  });

  test('engagement_rate_30d is null when there are no followers, even with posts', async () => {
    mockCompetitorFindMany.mockResolvedValue([]);
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ post_count: 10, total_likes: 500, total_comments: 100 }]);

    const result = await computeEntityKpis({ linked_business: 'bp-1', competitor_id: 'c1' });

    expect(result.followers).toBeNull();
    expect(result.avg_interactions_30d).toBe(60);
    expect(result.engagement_rate_30d).toBeNull();
  });

  test('engagement_rate_30d computes (avg_interactions / followers) * 100', async () => {
    mockCompetitorFindMany.mockResolvedValue([{ platform: 'instagram', follower_count: 1000 }]);
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ post_count: 10, total_likes: 500, total_comments: 100 }]);

    const result = await computeEntityKpis({ linked_business: 'bp-1', competitor_id: 'c1' });

    expect(result.avg_interactions_30d).toBe(60); // round((500+100)/10)
    expect(result.engagement_rate_30d).toBeCloseTo(6.0);
  });
});
