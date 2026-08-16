/**
 * Unit tests — findDonorCandidates identity matching.
 */

const queryRawUnsafe = jest.fn();

jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args) },
}));

import { findDonorCandidates } from '../lib/competitorDonor';

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns [] without querying when neither google_place_id nor a URL is given', async () => {
  const result = await findDonorCandidates('c1', 'b1', { platform: 'instagram', googlePlaceId: null, urlValue: null });
  expect(result).toEqual([]);
  expect(queryRawUnsafe).not.toHaveBeenCalled();
});

test('queries with the right params, excluding own competitor id and own business', async () => {
  queryRawUnsafe.mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);

  const result = await findDonorCandidates('c1', 'b1', {
    platform: 'facebook', googlePlaceId: 'place-123', urlValue: 'https://facebook.com/x',
  });

  expect(result).toEqual([{ id: 'donor-1', linked_business: 'other-biz' }]);
  const [sql, ...params] = queryRawUnsafe.mock.calls[0];
  expect(sql).toContain('facebook_url');
  expect(sql).toContain('id != $1');
  expect(sql).toContain('linked_business != $2');
  expect(sql).toContain("tracking_status = 'approved'");
  expect(params).toEqual(['c1', 'b1', 'place-123', 'https://facebook.com/x']);
});

test('uses the correct URL column per platform', async () => {
  queryRawUnsafe.mockResolvedValue([]);
  await findDonorCandidates('c1', 'b1', { platform: 'tiktok', googlePlaceId: null, urlValue: 'https://tiktok.com/@x' });
  expect(queryRawUnsafe.mock.calls[0][0]).toContain('tiktok_url');

  await findDonorCandidates('c1', 'b1', { platform: 'instagram', googlePlaceId: null, urlValue: 'https://instagram.com/x' });
  expect(queryRawUnsafe.mock.calls[1][0]).toContain('instagram_url');
});
