/**
 * planConfig.js — Single source of truth for plan limits and cost estimates.
 * Used by: useScanQuota, PlanGate, AdminDashboard.
 */

export const PLAN_LIMITS = {
  free_trial: {
    scans_per_month: 1,
    signals_max:     5,
    competitors_max: 3,
    posts_per_month: 1,
    images_per_month: 0,
    leads_social:    false,
    trends:          false,
    viral:           false,
    weekly_report:   false,
    battlecard:      false,
    integrations:    false,
  },
  starter: {
    scans_per_month: 4,
    signals_max:     15,
    competitors_max: 5,
    posts_per_month: 5,
    images_per_month: 0,
    leads_social:    false,
    trends:          false,
    viral:           false,
    weekly_report:   false,
    battlecard:      false,
    integrations:    false,
  },
  growth: {
    scans_per_month: 30,
    signals_max:     Infinity,
    competitors_max: 10,
    posts_per_month: 30,
    images_per_month: 10,
    leads_social:    true,
    trends:          true,
    viral:           true,
    weekly_report:   true,
    battlecard:      true,
    integrations:    false,
  },
  pro: {
    scans_per_month: Infinity,
    signals_max:     Infinity,
    competitors_max: Infinity,
    posts_per_month: Infinity,
    images_per_month: Infinity,
    leads_social:    true,
    trends:          true,
    viral:           true,
    weekly_report:   true,
    battlecard:      true,
    integrations:    true,
  },
  enterprise: {
    scans_per_month: Infinity,
    signals_max:     Infinity,
    competitors_max: Infinity,
    posts_per_month: Infinity,
    images_per_month: Infinity,
    leads_social:    true,
    trends:          true,
    viral:           true,
    weekly_report:   true,
    battlecard:      true,
    integrations:    true,
  },
};

// Cost estimates per full scan (USD)
export const COST_PER_SCAN = 0.40;   // Tavily + LLM + Places
export const COST_PER_POST = 0.015;  // GPT-4o post generation
export const COST_PER_IMAGE = 0.04;  // DALL-E 3

export function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free_trial;
}
