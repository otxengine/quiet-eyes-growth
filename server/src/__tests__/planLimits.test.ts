/**
 * Social collection (Apify) is the costliest per-customer item, so the plan decides whether,
 * how often and for how many competitors it runs. These pin the memo's 2026-11-03 numbers.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    automationLog: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

import { prisma } from '../db';
import { planLimits, socialSkipReason, socialGate, socialCompetitors } from '../lib/planLimits';

const DAY = 24 * 60 * 60 * 1000;
const lastRunAgo = (ms: number | null) =>
  (prisma.automationLog.findFirst as jest.Mock).mockResolvedValue(ms == null ? null : { created_date: new Date(Date.now() - ms) });

beforeEach(() => jest.clearAllMocks());

test('unknown plans and the schema default fall back to free', () => {
  expect(planLimits('free')).toBe(planLimits('free_trial'));
  expect(planLimits(null).social_every_days).toBeNull();
});

test('free gets no social collection, even when forced', async () => {
  lastRunAgo(null);
  expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', planLimits('free_trial'), { force: true })).toBe('plan_no_social');
});

test('stories are Pro only', async () => {
  lastRunAgo(null);
  expect(await socialSkipReason('b', 'collectCompetitorSocialStories', planLimits('growth'), { force: true, stories: true })).toBe('plan_no_stories');
  expect(await socialSkipReason('b', 'collectCompetitorSocialStories', planLimits('pro'), { stories: true })).toBeNull();
});

test('starter collects weekly; force skips only the cadence', async () => {
  const starter = planLimits('starter');
  lastRunAgo(3 * DAY);
  expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', starter)).toBe('plan_cadence');
  expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', starter, { force: true })).toBeNull();
  lastRunAgo(7 * DAY - 60 * 60 * 1000); // last week's cron ran an hour later than today's
  expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', starter)).toBeNull();
  // only real runs start the wait: no-op successes (no_social_url, ...) carry a message
  expect(prisma.automationLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { automation_name: 'collectCompetitorSocialPosts', linked_business: 'b', status: 'success', error_message: null },
  }));
});

test('pro stories run daily, not twice a day', async () => {
  lastRunAgo(10 * 60 * 60 * 1000);
  expect(await socialSkipReason('b', 'collectCompetitorSocialStories', planLimits('pro'), { stories: true })).toBe('plan_cadence');
  lastRunAgo(23 * 60 * 60 * 1000);
  expect(await socialSkipReason('b', 'collectCompetitorSocialStories', planLimits('pro'), { stories: true })).toBeNull();
});

test('a skip is logged so a waiting browser gets an answer', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ subscription_plan: 'starter' });
  lastRunAgo(DAY);
  const { skip } = await socialGate('b', 'collectCompetitorSocialProfile');
  expect(skip).toBe('plan_cadence');
  expect(prisma.automationLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ automation_name: 'collectCompetitorSocialProfile', status: 'skipped', error_message: 'plan_cadence' }),
  });
});

test('pro collects social data for its 11 oldest competitors', () => {
  const comps = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, created_date: new Date(Date.UTC(2026, 0, 14 - i)) }));
  expect(socialCompetitors(comps, planLimits('pro')).map(c => c.id)).toEqual(
    ['c13', 'c12', 'c11', 'c10', 'c9', 'c8', 'c7', 'c6', 'c5', 'c4', 'c3'],
  );
  expect(socialCompetitors(comps, planLimits('free_trial'))).toEqual([]);
  // competitors created in one batch share created_date; the cap must keep the same ones every run
  const batch = ['z', 'a', 'm'].map(id => ({ id, created_date: new Date(Date.UTC(2026, 0, 1)) }));
  expect(socialCompetitors(batch, { ...planLimits('starter'), social_competitors_max: 2 }).map(c => c.id)).toEqual(['a', 'm']);
});
