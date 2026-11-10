import { prisma } from '../db';
import { writeAutomationLog } from './automationLog';
import type { ReportType } from './reportPeriod';
import { businessLocale } from './businessLocale';

// ponytail: mirrors src/lib/planConfig.js — update both if plan limits change.
// social_every_days: how often competitor and own IG/FB collection (Apify) runs; null = never.
// social_competitors_max: how many competitors (oldest first) get that collection.
interface PlanLimits {
  scans_per_month: number;
  competitors_max: number;
  social_every_days: number | null;
  social_competitors_max: number;
  stories: boolean; // competitor stories, collected daily
  reports: ReportType[]; // which competitor reports (generateReport.ts) the plan gets
  // How often competitor ads and Google reviews are collected. Unset = every scheduled run (daily),
  // which is what every app plan does.
  ads_every_days?: number;
  reviews_every_days?: number;
  // Weekly collection runs on the days a report is built (see isReportDay) instead of every 7 days
  // from the first run, so each weekly and monthly report has data up to the end of its period.
  report_aligned?: boolean;
  // false = the monthly report is a summary of the competitors only: no "you vs. your competitors"
  // section, and the business's own pages are not collected. Unset = included.
  own_in_report?: boolean;
}

const ALL_REPORTS: ReportType[] = ['daily', 'weekly', 'monthly'];
const PRO: PlanLimits = { scans_per_month: Infinity, competitors_max: Infinity, social_every_days: 3, social_competitors_max: 11, stories: true, reports: ALL_REPORTS };

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free_trial: { scans_per_month: 1,  competitors_max: 3,  social_every_days: null, social_competitors_max: 0,  stories: false, reports: [] },
  starter:    { scans_per_month: 4,  competitors_max: 5,  social_every_days: 7,    social_competitors_max: 5,  stories: false, reports: ALL_REPORTS },
  growth:     { scans_per_month: 30, competitors_max: 10, social_every_days: 5,    social_competitors_max: 10, stories: false, reports: ALL_REPORTS },
  pro:        PRO,
  enterprise: PRO,
  // Report-only ("briefing") plans, sold outside Israel: the competitor report and nothing else of
  // the app. The collection cadence is the report cadence — a monthly report needs one scan a month.
  // Posts are collected as often as the plan's reports go out: monthly on Free and Monthly, weekly on
  // Weekly, daily on Daily and Plus. Ads: monthly on Free, weekly on Monthly and Weekly, daily above.
  // Google reviews: weekly on all. Stories: every paid plan (competitors post their offers there), not
  // Free. They expire after 24h, so that is a daily Apify run per business — the only daily job on
  // Monthly and Weekly. Free's monthly report is a summary of the competitors only.
  brief_free:    { scans_per_month: 1, competitors_max: 2,  social_every_days: 30, social_competitors_max: 2,  stories: false, reports: ['monthly'],           ads_every_days: 30, reviews_every_days: 7, report_aligned: true, own_in_report: false },
  brief_monthly: { scans_per_month: 2, competitors_max: 3,  social_every_days: 30, social_competitors_max: 3,  stories: true,  reports: ['monthly'],           ads_every_days: 7,  reviews_every_days: 7, report_aligned: true },
  brief_weekly:  { scans_per_month: 2, competitors_max: 3,  social_every_days: 7,  social_competitors_max: 3,  stories: true,  reports: ['weekly', 'monthly'], ads_every_days: 7,  reviews_every_days: 7, report_aligned: true },
  brief_daily:  { scans_per_month: 4, competitors_max: 5,  social_every_days: 1, social_competitors_max: 5,  stories: true,  reports: ALL_REPORTS,           reviews_every_days: 7, report_aligned: true },
  brief_plus:   { scans_per_month: 4, competitors_max: 10, social_every_days: 1, social_competitors_max: 10, stories: true,  reports: ALL_REPORTS,           reviews_every_days: 7, report_aligned: true },
};

/** A report-only plan: the business gets the competitor report pipeline and no other agent. */
export const isBriefingPlan = (plan?: string | null): boolean => !!plan && plan.startsWith('brief_');

/** Unknown plans, including the schema default 'free', get the free plan's limits. */
export function planLimits(plan?: string | null): PlanLimits {
  return (plan && PLAN_LIMITS[plan]) || PLAN_LIMITS.free_trial;
}

export async function businessPlanLimits(businessProfileId: string): Promise<PlanLimits> {
  const biz = await prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { subscription_plan: true } });
  return planLimits(biz?.subscription_plan);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CRON_SLACK_MS = 4 * 60 * 60 * 1000; // a daily 05:30 run must not miss its slot by minutes

/**
 * The days a weekly or monthly report is built, in the business's timezone: Sunday (the weekly covers
 * the Sunday–Saturday before it) and the 1st (the monthly covers the month before it).
 */
export function isReportDay(tz: string, now: Date = new Date(), monthlyOnly = false): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value;
  return (!monthlyOnly && get('weekday') === 'Sun') || get('day') === '1';
}


/** Whether `agent`'s last real run is old enough for a plan that runs it every `everyDays`. */
async function cadenceDue(businessProfileId: string, agent: string, everyDays: number, aligned: boolean): Promise<boolean> {
  const last = await prisma.automationLog.findFirst({
    where: { automation_name: agent, linked_business: businessProfileId, status: 'success', error_message: null },
    orderBy: { created_date: 'desc' },
    select: { created_date: true },
  });
  if (!last) return true; // never ran: the first scan happens right away
  const age = Date.now() - last.created_date.getTime();
  // Weekly work runs on Sundays and the 1st; monthly work on the 1st only.
  if (aligned && everyDays >= 7) {
    return age > DAY_MS - CRON_SLACK_MS && isReportDay((await businessLocale(businessProfileId)).tz, new Date(), everyDays >= 28);
  }
  return age >= everyDays * DAY_MS - CRON_SLACK_MS;
}

/**
 * The plan cadence of a report collector that isn't one of the social scrapers (ads, reviews): the
 * reason it must wait, or null. Plans that don't set `everyDays` aren't gated here at all.
 */
export async function collectorSkipReason(
  businessProfileId: string,
  agent: string,
  everyDays: number | undefined,
  limits: PlanLimits,
  force = false,
): Promise<string | null> {
  if (force || everyDays == null) return null;
  return (await cadenceDue(businessProfileId, agent, everyDays, !!limits.report_aligned)) ? null : 'plan_cadence';
}

/**
 * Why a social collector must not run for this business now, or null when it may.
 * The plan rules hold even with `force`; `force` only skips the cadence. The cadence reads the
 * last successful run from automation_logs, so it survives restarts. No-op successes (no_apify_key,
 * no_social_url, ...) carry a message and don't count, so a newly added URL isn't made to wait.
 * ponytail: failed runs don't count either, so a failure retries on the next call; and two calls
 * racing before the first logs both run. Add a started-run marker if either shows up in Apify spend.
 */
export async function socialSkipReason(
  businessProfileId: string,
  agent: string,
  limits: PlanLimits,
  { force = false, stories = false, own = false }: { force?: boolean; stories?: boolean; own?: boolean } = {},
): Promise<string | null> {
  if (limits.social_every_days == null) return 'plan_no_social';
  if (own && limits.own_in_report === false) return 'plan_no_own'; // the business's own pages
  if (stories && !limits.stories) return 'plan_no_stories';
  if (force) return null;
  const due = await cadenceDue(businessProfileId, agent, stories ? 1 : limits.social_every_days, !!limits.report_aligned);
  return due ? null : 'plan_cadence';
}

/**
 * The plan check at the top of every social collector. A skip is logged so a browser waiting on
 * automation_logs for this run gets an answer instead of timing out.
 */
export async function socialGate(
  businessProfileId: string,
  agent: string,
  opts: { force?: boolean; stories?: boolean; own?: boolean } = {},
): Promise<{ limits: PlanLimits; skip: string | null }> {
  const limits = await businessPlanLimits(businessProfileId);
  const skip = await socialSkipReason(businessProfileId, agent, limits, opts);
  if (skip) await writeAutomationLog(agent, businessProfileId, new Date().toISOString(), 0, 'skipped', skip);
  return { limits, skip };
}

/** The competitors a plan collects social data for: the oldest-tracked ones first. */
export function socialCompetitors<T extends { id: string; created_date: Date }>(competitors: T[], limits: PlanLimits): T[] {
  return [...competitors]
    .sort((a, b) => a.created_date.getTime() - b.created_date.getTime() || a.id.localeCompare(b.id))
    .slice(0, limits.social_competitors_max);
}
