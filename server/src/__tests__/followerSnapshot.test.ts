import { recordFollowerSnapshot } from '../lib/followerSnapshot';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: {
    metricsSnapshot: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

const mockFindFirst = prisma.metricsSnapshot.findFirst as jest.Mock;
const mockCreate = prisma.metricsSnapshot.create as jest.Mock;

describe('recordFollowerSnapshot', () => {
  afterEach(() => jest.clearAllMocks());

  test('skips when follower_count is null', async () => {
    await recordFollowerSnapshot({ linked_business: 'bp-1', platform: 'instagram', follower_count: null });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('skips when follower_count is undefined', async () => {
    await recordFollowerSnapshot({ linked_business: 'bp-1', platform: 'instagram', follower_count: undefined });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('skips write when a snapshot for this entity+platform+day already exists', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing-row' });
    await recordFollowerSnapshot({ linked_business: 'bp-1', platform: 'instagram', follower_count: 500 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('writes a row with metric_name "followers:<platform>" when none exists yet', async () => {
    mockFindFirst.mockResolvedValue(null);
    await recordFollowerSnapshot({ linked_business: 'bp-1', platform: 'instagram', follower_count: 500 });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        linked_business: 'bp-1',
        competitor_id: null,
        metric_name: 'followers:instagram',
        metric_value: 500,
      }),
    }));
  });

  test('records competitor_id when given', async () => {
    mockFindFirst.mockResolvedValue(null);
    await recordFollowerSnapshot({ linked_business: 'bp-1', competitor_id: 'c1', platform: 'facebook', follower_count: 200 });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitor_id: 'c1', metric_name: 'followers:facebook' }),
    }));
  });
});
