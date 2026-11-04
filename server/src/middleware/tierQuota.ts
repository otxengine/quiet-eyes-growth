/**
 * Tier Quota Middleware
 *
 * Enforces per-subscription-tier rate limits on scan/signal API calls.
 * Limits are defined per plan_id and tracked with a 24-hour rolling window
 * using an in-process LRU-style Map (restarts on server redeploy — acceptable
 * for MVP; replace with Redis in production).
 *
 * Tiers (from marketing plan):
 *   free_trial  →  10 scans/day,  3 agents
 *   basic       →  50 scans/day,  8 agents
 *   premium     → 200 scans/day, all agents
 *   enterprise  → unlimited
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { getUserId } from './auth';

// ── Tier config ──────────────────────────────────────────────────────────────

interface TierLimits {
  dailyScans: number;       // max API signal scans per 24h
  maxAgents: number;        // max concurrent agents
  campaignsEnabled: boolean;
  trendWindowDays: number;  // rolling window for SectorTrendRadar
}

const TIER_LIMITS: Record<string, TierLimits> = {
  free_trial: {
    dailyScans: 10,
    maxAgents: 3,
    campaignsEnabled: false,
    trendWindowDays: 2,
  },
  basic: {
    dailyScans: 50,
    maxAgents: 8,
    campaignsEnabled: false,
    trendWindowDays: 14,
  },
  premium: {
    dailyScans: 200,
    maxAgents: 99,
    campaignsEnabled: true,
    trendWindowDays: 30,
  },
  enterprise: {
    dailyScans: Infinity,
    maxAgents: 99,
    campaignsEnabled: true,
    trendWindowDays: 30,
  },
};

const DEFAULT_TIER = 'free_trial';

// ── In-process usage tracker ─────────────────────────────────────────────────
// Key: businessId, Value: { count, windowStart }
const usageMap = new Map<string, { count: number; windowStart: number }>();

function getUsage(businessId: string): { count: number; windowStart: number } {
  const now = Date.now();
  const existing = usageMap.get(businessId);
  if (!existing || now - existing.windowStart > 24 * 60 * 60 * 1000) {
    const entry = { count: 0, windowStart: now };
    usageMap.set(businessId, entry);
    return entry;
  }
  return existing;
}

function incrementUsage(businessId: string): number {
  const usage = getUsage(businessId);
  usage.count += 1;
  usageMap.set(businessId, usage);
  return usage.count;
}

// ── Business profile lookup (cached 5 min) ───────────────────────────────────
const profileCache = new Map<string, { planId: string; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function getPlanId(userId: string): Promise<string> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.planId;
  }
  try {
    const profile = await prisma.businessProfile.findFirst({
      where: { created_by: userId },
      select: { plan_id: true },
    });
    const planId = profile?.plan_id ?? DEFAULT_TIER;
    profileCache.set(userId, { planId, cachedAt: Date.now() });
    return planId;
  } catch {
    return DEFAULT_TIER;
  }
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces the daily scan quota.
 * Attach to routes that trigger external API calls (signal scans, crawls, etc.)
 */
export function requireScanQuota() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    if (!userId) return next(); // auth middleware will handle unauthorised

    try {
      const planId = await getPlanId(userId);
      const limits = TIER_LIMITS[planId] ?? TIER_LIMITS[DEFAULT_TIER];

      if (limits.dailyScans === Infinity) return next(); // enterprise — no cap

      const businessId = userId; // 1:1 in MVP
      const current = getUsage(businessId).count;

      if (current >= limits.dailyScans) {
        const resetAt = new Date(getUsage(businessId).windowStart + 24 * 60 * 60 * 1000);
        return res.status(429).json({
          error: 'quota_exceeded',
          message: `הגעת למכסה היומית של ${limits.dailyScans} סריקות (מנוי ${planId}). המכסה מתאפסת ב-${resetAt.toLocaleTimeString('he-IL')}.`,
          plan: planId,
          limit: limits.dailyScans,
          used: current,
          resetAt: resetAt.toISOString(),
          upgradeUrl: '/subscription',
        });
      }

      // Increment before passing — prevents double-counting on retries
      incrementUsage(businessId);

      // Expose tier info to route handlers
      (req as any).tierLimits = limits;
      (req as any).planId = planId;

      next();
    } catch {
      // On DB error, allow the request through (fail open for availability)
      next();
    }
  };
}

/**
 * Middleware that blocks campaign-related endpoints for tiers that don't
 * include automatic campaigns (free_trial + basic).
 */
export function requireCampaignsEnabled() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = getUserId(req);
    if (!userId) return next();

    try {
      const planId = await getPlanId(userId);
      const limits = TIER_LIMITS[planId] ?? TIER_LIMITS[DEFAULT_TIER];

      if (!limits.campaignsEnabled) {
        return res.status(403).json({
          error: 'plan_restriction',
          message: 'קמפיינים אוטומטיים זמינים ממנוי Premium בלבד.',
          plan: planId,
          upgradeUrl: '/subscription',
        });
      }

      (req as any).tierLimits = limits;
      (req as any).planId = planId;
      next();
    } catch {
      next();
    }
  };
}

/**
 * Returns the TierLimits for the given plan_id, with a safe default.
 * Use in business logic that needs to know limits without middleware.
 */
export function getTierLimits(planId: string | null | undefined): TierLimits {
  return TIER_LIMITS[planId ?? DEFAULT_TIER] ?? TIER_LIMITS[DEFAULT_TIER];
}

export { TIER_LIMITS, DEFAULT_TIER };
export type { TierLimits };
