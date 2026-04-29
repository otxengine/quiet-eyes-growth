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

// Cost per individual agent run (USD)
export const AGENT_COSTS = {
  collectWebSignals:           0.10,
  collectSocialSignals:        0.05,
  runMarketIntelligence:       0.06,
  runCompetitorIdentification: 0.05,
  competitorIntelAgent:        0.08,
  detectCompetitorChanges:     0.03,
  scanServicesAndPrices:       0.05,
  findSocialLeads:             0.05,
  generateWeeklyReport:        0.08,
  detectTrends:                0.04,
  detectEarlyTrends:           0.04,
  detectViralSignals:          0.03,
  generateProactiveAlerts:     0.04,
  runPredictions:              0.05,
  autoRespondToReviews:        0.03,
  reviewRequestAutomation:     0.02,
  generatePost:                0.015,
  generateImage:               0.04,
  runMLLearning:               0.02,
  cleanupAndLearn:             0.01,
  calculateHealthScore:        0.01,
  googleRankMonitor:           0.02,
  smartLeadNurture:            0.02,
  contentCalendarAgent:        0.03,
  detectEvents:                0.03,
  runFullScan:                 0.40,
};

export function agentCost(name) {
  return AGENT_COSTS[name] ?? 0.02;
}

export function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free_trial;
}
