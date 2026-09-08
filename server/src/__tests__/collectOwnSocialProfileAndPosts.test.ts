/**
 * Unit tests — collectOwnSocialProfileAndPosts orchestrator.
 * Covers: the before/after businessSocialProfile diff correctly builds
 * platformCapOverrides for the posts scraper, and — critically — never fabricates
 * a signal when the profile scrape was itself skipped that day (fetched_at unmoved).
 */

const findMany = jest.fn();

jest.mock('../db', () => ({
  prisma: { businessSocialProfile: { findMany: (...args: any[]) => findMany(...args) } },
}));

const collectOwnSocialProfileMock = jest.fn();
jest.mock('../routes/functions/collectOwnSocialProfile', () => ({
  collectOwnSocialProfile: (...args: any[]) => collectOwnSocialProfileMock(...args),
}));

const collectOwnSocialPostsMock = jest.fn();
jest.mock('../routes/functions/collectOwnSocialPosts', () => ({
  collectOwnSocialPosts: (...args: any[]) => collectOwnSocialPostsMock(...args),
}));

import { collectOwnSocialProfileAndPosts } from '../routes/functions/collectOwnSocialProfileAndPosts';

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  collectOwnSocialPostsMock.mockImplementation(async (_req: any, res: any) => res.json({ upserted: 0 }));
});

test('post_count increase produces a clamped instagram override', async () => {
  findMany
    .mockResolvedValueOnce([{ platform: 'instagram', post_count: 5, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') }])
    .mockResolvedValueOnce([{ platform: 'instagram', post_count: 8, last_post_at: null, fetched_at: new Date('2026-01-02T00:00:00Z') }]);

  await collectOwnSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectOwnSocialPostsMock.mock.calls[0];
  expect(postsReq.body.platformCapOverrides).toEqual({ instagram: { kind: 'clamped', limit: 3 } });
});

test('unchanged facebook last_post_at produces a skip override', async () => {
  const t = new Date('2026-01-01T00:00:00Z');
  findMany
    .mockResolvedValueOnce([{ platform: 'facebook', post_count: null, last_post_at: t, fetched_at: new Date('2026-01-01T05:00:00Z') }])
    .mockResolvedValueOnce([{ platform: 'facebook', post_count: null, last_post_at: t, fetched_at: new Date('2026-01-02T05:00:00Z') }]);

  await collectOwnSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectOwnSocialPostsMock.mock.calls[0];
  expect(postsReq.body.platformCapOverrides).toEqual({ facebook: { kind: 'skip' } });
});

test('profile scrape skipped that day (fetched_at unmoved) never produces a false skip', async () => {
  const before = { platform: 'instagram', post_count: 5, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') };
  findMany.mockResolvedValueOnce([before]).mockResolvedValueOnce([before]); // identical, including fetched_at

  await collectOwnSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectOwnSocialPostsMock.mock.calls[0];
  expect(postsReq.body.platformCapOverrides).toEqual({});
});

test('first-ever profile scrape (no prior row) never produces an override', async () => {
  findMany
    .mockResolvedValueOnce([]) // before: nothing yet
    .mockResolvedValueOnce([{ platform: 'instagram', post_count: 12, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') }]);

  await collectOwnSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectOwnSocialPostsMock.mock.calls[0];
  expect(postsReq.body.platformCapOverrides).toEqual({});
});
