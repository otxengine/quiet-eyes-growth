/**
 * Unit tests — collectCompetitorSocialProfileAndPosts orchestrator.
 * Covers: the before/after competitorSocialProfile diff correctly builds
 * competitorPlatformOverrides keyed by competitor id, and never fabricates a
 * signal when a given competitor's profile scrape was itself skipped that day
 * (fetched_at unmoved).
 */

const findMany = jest.fn();

jest.mock('../db', () => ({
  prisma: { competitorSocialProfile: { findMany: (...args: any[]) => findMany(...args) } },
}));

const collectCompetitorSocialProfileMock = jest.fn();
jest.mock('../routes/functions/collectCompetitorSocialProfile', () => ({
  collectCompetitorSocialProfile: (...args: any[]) => collectCompetitorSocialProfileMock(...args),
}));

const collectCompetitorSocialPostsMock = jest.fn();
jest.mock('../routes/functions/collectCompetitorSocialPosts', () => ({
  collectCompetitorSocialPosts: (...args: any[]) => collectCompetitorSocialPostsMock(...args),
}));

import { collectCompetitorSocialProfileAndPosts } from '../routes/functions/collectCompetitorSocialProfileAndPosts';

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  collectCompetitorSocialPostsMock.mockImplementation(async (_req: any, res: any) => res.json({ upserted: 0 }));
});

test('post_count increase produces a clamped override keyed by competitor id', async () => {
  findMany
    .mockResolvedValueOnce([{ competitor_id: 'c1', platform: 'instagram', post_count: 5, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') }])
    .mockResolvedValueOnce([{ competitor_id: 'c1', platform: 'instagram', post_count: 9, last_post_at: null, fetched_at: new Date('2026-01-02T00:00:00Z') }]);

  await collectCompetitorSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectCompetitorSocialPostsMock.mock.calls[0];
  expect(postsReq.body.competitorPlatformOverrides).toEqual({ c1: { instagram: { kind: 'clamped', limit: 4 } } });
});

test('profile scrape skipped for a competitor (fetched_at unmoved) never produces a false skip', async () => {
  const row = { competitor_id: 'c1', platform: 'facebook', post_count: null, last_post_at: new Date('2026-01-01T00:00:00Z'), fetched_at: new Date('2026-01-01T00:00:00Z') };
  findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);

  await collectCompetitorSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectCompetitorSocialPostsMock.mock.calls[0];
  expect(postsReq.body.competitorPlatformOverrides).toEqual({});
});

test('two competitors get independently keyed overrides', async () => {
  findMany
    .mockResolvedValueOnce([
      { competitor_id: 'c1', platform: 'instagram', post_count: 5, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') },
      { competitor_id: 'c2', platform: 'instagram', post_count: 3, last_post_at: null, fetched_at: new Date('2026-01-01T00:00:00Z') },
    ])
    .mockResolvedValueOnce([
      { competitor_id: 'c1', platform: 'instagram', post_count: 5, last_post_at: null, fetched_at: new Date('2026-01-02T00:00:00Z') }, // unchanged -> skip
      { competitor_id: 'c2', platform: 'instagram', post_count: 4, last_post_at: null, fetched_at: new Date('2026-01-02T00:00:00Z') }, // +1 -> clamped
    ]);

  await collectCompetitorSocialProfileAndPosts({ body: { businessProfileId: 'b1' } } as any, mockRes());

  const [postsReq] = collectCompetitorSocialPostsMock.mock.calls[0];
  expect(postsReq.body.competitorPlatformOverrides).toEqual({
    c1: { instagram: { kind: 'skip' } },
    c2: { instagram: { kind: 'clamped', limit: 1 } },
  });
});
