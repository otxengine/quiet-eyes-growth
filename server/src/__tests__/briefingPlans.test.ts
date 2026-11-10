// Report-only ("briefing") plans: limits, which reports each plan gets, prices and the scheduler gate.
jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));

import { PLAN_LIMITS, planLimits, isBriefingPlan } from '../lib/planLimits';
import { PLAN_PRICES, planCurrency, priceIds, planFromPriceId } from '../lib/paddle';

describe('plan limits', () => {
  const BRIEF = ['brief_free', 'brief_monthly', 'brief_weekly', 'brief_daily', 'brief_plus'];
  it('report-only plans: competitors 2 / 3 / 3 / 5 / 10, stories on every paid one, not Free', () => {
    expect(BRIEF.map(p => PLAN_LIMITS[p].competitors_max)).toEqual([2, 3, 3, 5, 10]);
    expect(BRIEF.map(p => PLAN_LIMITS[p].stories)).toEqual([false, true, true, true, true]);
    // posts as often as the reports go out; ads monthly on Free, weekly on Monthly and Weekly, daily above; reviews weekly on all
    expect(BRIEF.map(p => PLAN_LIMITS[p].social_every_days)).toEqual([30, 30, 7, 1, 1]);
    expect(BRIEF.map(p => PLAN_LIMITS[p].ads_every_days)).toEqual([30, 7, 7, undefined, undefined]);
    expect(BRIEF.map(p => PLAN_LIMITS[p].reviews_every_days)).toEqual([7, 7, 7, 7, 7]);
    // "you vs. your competitors": every paid plan, not Free
    expect(BRIEF.map(p => PLAN_LIMITS[p].own_in_report !== false)).toEqual([false, true, true, true, true]);
    expect(PLAN_LIMITS.starter.ads_every_days).toBeUndefined(); // app plans are not gated by these
    expect(PLAN_LIMITS.starter.stories).toBe(false); // Hebrew plans unchanged: stories stay Pro only
    for (const p of Object.keys(PLAN_LIMITS).filter(isBriefingPlan)) {
      expect(PLAN_LIMITS[p].social_competitors_max).toBe(PLAN_LIMITS[p].competitors_max);
    }
  });

  it('reports by cadence: free = monthly, weekly = weekly + monthly, daily plans = all three', () => {
    expect(planLimits('brief_free').reports).toEqual(['monthly']);
    expect(planLimits('brief_monthly').reports).toEqual(['monthly']);
    expect(planLimits('brief_weekly').reports).toEqual(['weekly', 'monthly']);
    expect(planLimits('brief_daily').reports).toEqual(['daily', 'weekly', 'monthly']);
    expect(planLimits('brief_plus').reports).toEqual(['daily', 'weekly', 'monthly']);
  });

  it('app plans are unchanged: paid ones get all three reports, free and unknown get none', () => {
    for (const p of ['starter', 'growth', 'pro', 'enterprise']) expect(planLimits(p).reports).toEqual(['daily', 'weekly', 'monthly']);
    for (const p of ['free_trial', 'free', undefined, null, 'nonsense']) expect(planLimits(p as any).reports).toEqual([]);
    expect(PLAN_LIMITS.starter).toMatchObject({ competitors_max: 5, social_every_days: 7, stories: false });
  });

  it('isBriefingPlan', () => {
    expect(['brief_free', 'brief_plus'].every(isBriefingPlan)).toBe(true);
    expect(['starter', 'free_trial', '', null, undefined].some(p => isBriefingPlan(p as any))).toBe(false);
  });
});

describe('prices', () => {
  const OLD_ENV = process.env;
  afterAll(() => { process.env = OLD_ENV; });

  it('report-only plans are priced in USD, app plans in ILS', () => {
    expect([PLAN_PRICES.brief_monthly, PLAN_PRICES.brief_weekly, PLAN_PRICES.brief_daily, PLAN_PRICES.brief_plus]).toEqual([10, 29, 79, 149]);
    expect(PLAN_PRICES.brief_free).toBeUndefined(); // no checkout for the free plan
    expect(planCurrency('brief_daily')).toBe('USD');
    expect(planCurrency('starter')).toBe('ILS');
    expect(planCurrency(undefined)).toBe('ILS');
  });

  it('Paddle price ids map to and from the report-only plans', () => {
    process.env = { ...OLD_ENV, PADDLE_PRICE_BRIEF_DAILY: 'pri_new,pri_old', PADDLE_PRICE_STARTER: 'pri_starter' };
    expect(priceIds().brief_daily).toBe('pri_new');
    expect(planFromPriceId('pri_old')).toBe('brief_daily');
    expect(planFromPriceId('pri_starter')).toBe('starter');
  });
});
