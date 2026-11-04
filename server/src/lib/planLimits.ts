import { prisma } from '../db';
import { writeAutomationLog } from './automationLog';

// ponytail: mirrors src/lib/planConfig.js — update both if plan limits change.
// social_every_days: how often competitor and own IG/FB collection (Apify) runs; null = never.
// social_competitors_max: how many competitors (oldest first) get that collection.
interface PlanLimits {
  scans_per_month: number;
  competitors_max: number;
  social_every_days: number | null;
  social_competitors_max: number;
  stories: boolean; // competitor stories, collected daily
}

const PRO: PlanLimits = { scans_per_month: Infinity, competitors_max: Infinity, social_every_days: 3, social_competitors_max: 11, stories: true };

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free_trial: { scans_per_month: 1,  competitors_max: 3,  social_every_days: null, social_competitors_max: 0,  stories: false },
  starter:    { scans_per_month: 4,  competitors_max: 5,  social_every_days: 7,    social_competitors_max: 5,  stories: false },
  growth:     { scans_per_month: 30, competitors_max: 10, social_every_days: 5,    social_competitors_max: 10, stories: false },
  pro:        PRO,
  enterprise: PRO,
};

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
  { force = false, stories = false }: { force?: boolean; stories?: boolean } = {},
): Promise<string | null> {
  if (limits.social_every_days == null) return 'plan_no_social';
  if (stories && !limits.stories) return 'plan_no_stories';
  if (force) return null;
  const last = await prisma.automationLog.findFirst({
    where: { automation_name: agent, linked_business: businessProfileId, status: 'success', error_message: null },
    orderBy: { created_date: 'desc' },
    select: { created_date: true },
  });
  const everyMs = (stories ? 1 : limits.social_every_days) * DAY_MS - CRON_SLACK_MS;
  return last && Date.now() - last.created_date.getTime() < everyMs ? 'plan_cadence' : null;
}

/**
 * The plan check at the top of every social collector. A skip is logged so a browser waiting on
 * automation_logs for this run gets an answer instead of timing out.
 */
export async function socialGate(
  businessProfileId: string,
  agent: string,
  opts: { force?: boolean; stories?: boolean } = {},
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
