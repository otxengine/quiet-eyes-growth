// Plan cadence of the report collectors on the report-only plans: weekly work is pinned to report days.
const findFirst = jest.fn();
jest.mock('../db', () => ({ prisma: { automationLog: { findFirst: (...a: any[]) => findFirst(...a) } } }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/businessLocale', () => ({ businessLocale: jest.fn(async () => ({ lang: 'en', intl: 'en-US', tz: 'America/New_York' })) }));

import { PLAN_LIMITS, isReportDay, collectorSkipReason, socialSkipReason } from '../lib/planLimits';
import { steadyPostsCap } from '../lib/postsCap';

const HOUR = 3600_000;
const at = (iso: string) => jest.useFakeTimers().setSystemTime(new Date(iso));
const lastRan = (hoursAgo: number | null) =>
  findFirst.mockResolvedValue(hoursAgo == null ? null : { created_date: new Date(Date.now() - hoursAgo * HOUR) });
const weekly = PLAN_LIMITS.brief_weekly;

afterEach(() => { jest.useRealTimers(); findFirst.mockReset(); });

describe('isReportDay', () => {
  it('is Sunday or the 1st in the business timezone, not in UTC', () => {
    expect(isReportDay('America/New_York', new Date('2026-11-08T14:00:00Z'))).toBe(true);  // Sunday
    expect(isReportDay('America/New_York', new Date('2026-11-10T14:00:00Z'))).toBe(false); // Tuesday
    expect(isReportDay('America/New_York', new Date('2026-12-01T14:00:00Z'))).toBe(true);  // Tuesday the 1st
    // 03:00Z on Monday Nov 9 is still Sunday evening in Los Angeles
    expect(isReportDay('America/Los_Angeles', new Date('2026-11-09T03:00:00Z'))).toBe(true);
    expect(isReportDay('Asia/Jerusalem', new Date('2026-11-09T03:00:00Z'))).toBe(false);
  });
});

describe('weekly collection on a report-only plan', () => {
  it('the first scan runs right away, whatever the day', async () => {
    at('2026-11-10T09:30:00Z'); lastRan(null); // Tuesday
    expect(await collectorSkipReason('b', 'collectReviews', weekly.reviews_every_days, weekly)).toBeNull();
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', weekly)).toBeNull();
  });

  it('then waits for a report day, even when 7 days have passed', async () => {
    at('2026-11-18T09:30:00Z'); lastRan(8 * 24); // Wednesday, last ran 8 days ago
    expect(await collectorSkipReason('b', 'detectCompetitorAds', weekly.ads_every_days, weekly)).toBe('plan_cadence');
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', weekly)).toBe('plan_cadence');
  });

  it('runs on Sunday and on the 1st, once', async () => {
    at('2026-11-15T09:30:00Z'); lastRan(3 * 24); // Sunday, last ran Thursday
    expect(await collectorSkipReason('b', 'collectReviews', weekly.reviews_every_days, weekly)).toBeNull();
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', weekly)).toBeNull();
    lastRan(1); // already ran this morning
    expect(await collectorSkipReason('b', 'collectReviews', weekly.reviews_every_days, weekly)).toBe('plan_cadence');
    at('2026-12-01T09:30:00Z'); lastRan(2 * 24); // Tuesday the 1st
    expect(await collectorSkipReason('b', 'collectReviews', weekly.reviews_every_days, weekly)).toBeNull();
  });

  it('stories stay daily and force skips the cadence', async () => {
    at('2026-11-18T09:30:00Z'); lastRan(23);
    expect(await socialSkipReason('b', 'collectCompetitorSocialStories', weekly, { stories: true })).toBeNull();
    expect(await socialSkipReason('b', 'collectCompetitorSocialStories', PLAN_LIMITS.brief_free, { stories: true })).toBe('plan_no_stories');
    expect(await collectorSkipReason('b', 'detectCompetitorAds', weekly.ads_every_days, weekly, true)).toBeNull();
  });
});

describe('monthly collection (Free and Monthly plans) runs on the 1st only', () => {
  const free = PLAN_LIMITS.brief_free;
  it('waits through Sundays, runs on the 1st, and the first scan is immediate', async () => {
    at('2026-11-15T09:30:00Z'); lastRan(20 * 24); // a Sunday
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', free)).toBe('plan_cadence');
    expect(await collectorSkipReason('b', 'detectCompetitorAds', free.ads_every_days, free)).toBe('plan_cadence');
    expect(await collectorSkipReason('b', 'collectReviews', free.reviews_every_days, free)).toBeNull(); // reviews are weekly
    at('2026-12-01T09:30:00Z'); lastRan(20 * 24);
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', free)).toBeNull();
    expect(await collectorSkipReason('b', 'detectCompetitorAds', free.ads_every_days, free)).toBeNull();
    at('2026-11-18T09:30:00Z'); lastRan(null);
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', free)).toBeNull();
  });
  it('Free does not collect the business\'s own pages; paid plans do', async () => {
    at('2026-12-01T09:30:00Z'); lastRan(null);
    expect(await socialSkipReason('b', 'collectOwnSocialPosts', free, { own: true })).toBe('plan_no_own');
    expect(await socialSkipReason('b', 'collectOwnSocialPosts', PLAN_LIMITS.brief_monthly, { own: true })).toBeNull();
    expect(await socialSkipReason('b', 'collectOwnSocialPosts', PLAN_LIMITS.starter, { own: true })).toBeNull();
  });
});

describe('steady post pull size', () => {
  it('is the daily cap on daily plans and grows with the cadence, up to the backfill size', () => {
    expect([1, 3, 7, 30, null].map(d => steadyPostsCap(d, 5, 75))).toEqual([5, 8, 18, 75, 5]);
  });
});

describe('plans that do not set a cadence are not gated', () => {
  it('app plans and daily report-only ads never wait here', async () => {
    at('2026-11-18T09:30:00Z'); lastRan(1);
    expect(await collectorSkipReason('b', 'detectCompetitorAds', PLAN_LIMITS.starter.ads_every_days, PLAN_LIMITS.starter)).toBeNull();
    expect(await collectorSkipReason('b', 'collectReviews', PLAN_LIMITS.pro.reviews_every_days, PLAN_LIMITS.pro)).toBeNull();
    expect(await collectorSkipReason('b', 'detectCompetitorAds', PLAN_LIMITS.brief_daily.ads_every_days, PLAN_LIMITS.brief_daily)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('an app plan on a 7-day social cadence keeps its rolling 7 days', async () => {
    at('2026-11-18T09:30:00Z'); lastRan(7 * 24); // Wednesday, exactly a week later
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', PLAN_LIMITS.starter)).toBeNull();
    lastRan(3 * 24);
    expect(await socialSkipReason('b', 'collectCompetitorSocialPosts', PLAN_LIMITS.starter)).toBe('plan_cadence');
  });
});
