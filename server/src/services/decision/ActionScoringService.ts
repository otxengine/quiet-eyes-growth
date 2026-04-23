/**
 * ActionScoringService — scores a candidate decision.
 *
 * Implements all 5 scoring formulas from the hardening spec.
 * All weights and thresholds come from src/infra/config.ts.
 * Formula implementations live in src/learning/learning.formulas.ts.
 *
 * Final score formula (0–100):
 *   score = (0.30 × expected_roi)
 *         + (0.20 × confidence)
 *         + (0.20 × business_fit)
 *         + (0.15 × timing_fit)
 *         + (0.15 × historical_success)
 *
 * Business fit sub-formula:
 *   (0.35 × sector_match) + (0.20 × geo_match) + (0.15 × profile_alignment)
 *   + (0.15 × historical_acceptance_rate) + (0.15 × memory_preference_alignment)
 *
 * Timing fit sub-formula:
 *   (0.35 × immediacy_score) + (0.20 × forecast_window_alignment)
 *   + (0.20 × business_open_hours_alignment) + (0.15 × channel_timing_suitability)
 *   + (0.10 × seasonal_alignment)
 *
 * Historical success sub-formula:
 *   (0.40 × similar_action_success_rate) + (0.25 × similar_timing_success_rate)
 *   + (0.20 × channel_success_rate) + (0.15 × recent_positive_feedback_rate)
 *
 * Policy version is stamped on every ScoreBreakdown.
 */

import {
  EnrichedContext, FusedInsight, ScoreBreakdown, ActionType, ExecutionMode,
} from '../../models';
import { learningRepository } from '../../repositories/LearningRepository';
import { createLogger } from '../../infra/logger';
import { POLICY_VERSION, APPROVAL_REQUIRED_CHANNELS, AUTO_ALLOWED_CHANNELS, POLICY_THRESHOLDS } from '../../infra/config';
import {
  computeBusinessFitScore,
  computeTimingFitScore,
  computeHistoricalSuccessScore,
  computeFinalActionScore,
} from '../../learning/learning.formulas';
import { policyEngine } from '../../decision/decision.policy';

const logger = createLogger('ActionScoringService');

export const ACTION_TO_CHANNEL: Record<ActionType, string> = {
  content:             'instagram',
  campaign:            'facebook',
  promotion:           'whatsapp',
  outreach:            'whatsapp',
  reputation:          'google',
  retention:           'whatsapp',
  pricing:             'internal',
  expansion:           'internal',
  competitor_response: 'internal',
  alert:               'dashboard',
};

// ─── Expected ROI scorer (uses opportunity-score sub-components) ──────────────

function scoreExpectedRoi(
  actionType: ActionType,
  insight: FusedInsight,
  ctx: EnrichedContext,
): number {
  // Base ROI priors by action type
  const baseRoi: Record<ActionType, number> = {
    promotion: 0.85, campaign: 0.80, outreach: 0.75, reputation: 0.78,
    pricing: 0.72, retention: 0.70, content: 0.65, expansion: 0.60,
    competitor_response: 0.55, alert: 0.50,
  };

  let roi = baseRoi[actionType] ?? 0.5;

  // Boost from hot leads for outreach/campaign
  if (ctx.leads.hot > 0 && (actionType === 'outreach' || actionType === 'campaign')) {
    roi = Math.min(1, roi + ctx.leads.hot * 0.05);
  }

  // Boost if reviews are negative and action is reputation
  if (ctx.reviews.negative_last7d > 2 && actionType === 'reputation') {
    roi = Math.min(1, roi + 0.15);
  }

  // Boost from active opportunities matching this action type
  const oppBoost = ctx.active_opportunities.filter(o => {
    if (actionType === 'promotion'  && o.type === 'demand_spike')   return true;
    if (actionType === 'outreach'   && o.type === 'lead_surge')     return true;
    if (actionType === 'campaign'   && o.type === 'competitor_gap') return true;
    if (actionType === 'retention'  && o.type === 'retention_risk') return true;
    if (actionType === 'expansion'  && o.type === 'expansion_signal') return true;
    return false;
  }).length * 0.05;

  roi = Math.min(1, roi + oppBoost);

  // Scale by insight confidence
  return Math.min(1, roi * insight.confidence);
}

// ─── Business fit scorer (full sub-formula) ───────────────────────────────────

function scoreBusinessFit(
  actionType: ActionType,
  memory: EnrichedContext['memory'],
  ctx: EnrichedContext,
): number {
  if (!memory) {
    // No memory → neutral 0.5 with slight sector and geo contributions
    return computeBusinessFitScore({
      sector_match:                 0.5,
      geo_match:                    0.6,
      profile_alignment:            0.5,
      historical_acceptance_rate:   0.5,
      memory_preference_alignment:  0.5,
    });
  }

  // Rejected pattern → very low sector match
  const isRejected = memory.rejected_patterns.some(p =>
    p.toLowerCase().includes(actionType.toLowerCase()),
  );
  // Accepted pattern → high sector match
  const isAccepted = memory.accepted_patterns.some(p =>
    p.toLowerCase().includes(actionType.toLowerCase()),
  );

  const sector_match = isRejected ? 0.10 : isAccepted ? 0.90 : 0.55;

  // Geo match: always reasonable for a business in its own city
  const geo_match = 0.70;

  // Profile alignment: use channel preference if available
  const channel = ACTION_TO_CHANNEL[actionType];
  const channelPref = memory.channel_preferences?.[channel] ?? null;
  const profile_alignment = channelPref !== null
    ? Math.max(0.2, Math.min(0.95, channelPref))
    : 0.5;

  // Historical acceptance from agent weights
  const historical_acceptance_rate = memory.agent_weights?.[actionType] ?? 0.5;

  // Memory preference alignment: if this action type is in preferred_channels
  const prefChannels = memory.preferred_channels ?? [];
  const memory_preference_alignment = prefChannels.includes(channel)
    ? 0.85
    : channelPref !== null
      ? Math.max(0.3, channelPref)
      : 0.5;

  return computeBusinessFitScore({
    sector_match,
    geo_match,
    profile_alignment,
    historical_acceptance_rate: Math.max(0, Math.min(1, historical_acceptance_rate)),
    memory_preference_alignment,
  });
}

// ─── Timing fit scorer (full sub-formula) ────────────────────────────────────

function scoreTimingFit(
  actionType: ActionType,
  insight: FusedInsight,
  ctx: EnrichedContext,
): number {
  const hour      = (new Date().getUTCHours() + 3) % 24; // Israel UTC+3
  const dayOfWeek = new Date().getDay();
  const isBizHours = hour >= 9 && hour <= 20;

  // Immediacy: derived from insight urgency
  const urgencyImmediacy: Record<string, number> = {
    critical: 1.0, high: 0.80, medium: 0.55, low: 0.30,
  };
  const immediacy_score = urgencyImmediacy[insight.urgency] ?? 0.5;

  // Forecast window alignment: do active forecasts cover the next few days?
  const forecastsSupport = ctx.forecasts.filter(
    f => f.expected_demand_score > 60 && f.confidence > 0.6,
  ).length;
  const forecast_window_alignment = Math.min(1, 0.4 + forecastsSupport * 0.15);

  // Business open hours alignment
  const business_open_hours_alignment = isBizHours ? 0.90 : 0.35;

  // Channel timing suitability — learned preference
  const timingKey = `${dayOfWeek}_${hour}`;
  const learnedTiming = ctx.memory?.timing_preferences?.[timingKey] ?? null;
  let channel_timing_suitability = learnedTiming !== null
    ? Math.max(0.3, Math.min(0.95, learnedTiming))
    : 0.6;

  // Adjust by known best times when no learned preference
  if (learnedTiming === null) {
    if (actionType === 'promotion' && (dayOfWeek === 4 || dayOfWeek === 5)) channel_timing_suitability = 0.90;
    if (actionType === 'content'   && hour >= 7 && hour <= 10)              channel_timing_suitability = 0.85;
    if (actionType === 'outreach'  && isBizHours)                           channel_timing_suitability = 0.80;
    if (actionType === 'reputation')                                          channel_timing_suitability = 0.90;
    if (actionType === 'campaign'  && dayOfWeek >= 1 && dayOfWeek <= 3)     channel_timing_suitability = 0.80;
  }

  // Seasonal alignment: active opportunity with high urgency = good timing
  const hasHighOpp = ctx.active_opportunities.some(
    o => o.urgency === 'high' || o.urgency === 'critical',
  );
  const seasonal_alignment = hasHighOpp ? 0.85 : 0.55;

  return computeTimingFitScore({
    immediacy_score,
    forecast_window_alignment,
    business_open_hours_alignment,
    channel_timing_suitability,
    seasonal_alignment,
  });
}

// ─── Historical success scorer (full sub-formula) ─────────────────────────────

function buildHistoricalSuccessComponents(
  historicalSuccessRate: number,
  policyWeight: number,
  actionType: ActionType,
  ctx: EnrichedContext,
): Parameters<typeof computeHistoricalSuccessScore>[0] {
  // similar_action_success_rate: blended from repo data
  const similar_action_success_rate = historicalSuccessRate * 0.6 + policyWeight * 0.4;

  // similar_timing_success_rate: from timing preferences if available
  const hour = (new Date().getUTCHours() + 3) % 24;
  const day  = new Date().getDay();
  const timingKey = `${day}_${hour}`;
  const similar_timing_success_rate = ctx.memory?.timing_preferences?.[timingKey] ?? historicalSuccessRate;

  // channel_success_rate: from channel preferences
  const channel = ACTION_TO_CHANNEL[actionType];
  const channel_success_rate = ctx.memory?.channel_preferences?.[channel] ?? historicalSuccessRate;

  // recent_positive_feedback_rate: from accepted patterns ratio
  const totalPatterns = (ctx.memory?.accepted_patterns?.length ?? 0) +
                        (ctx.memory?.rejected_patterns?.length ?? 0);
  const recent_positive_feedback_rate = totalPatterns > 0
    ? (ctx.memory?.accepted_patterns?.length ?? 0) / totalPatterns
    : 0.5;

  return {
    similar_action_success_rate: Math.max(0, Math.min(1, similar_action_success_rate)),
    similar_timing_success_rate: Math.max(0, Math.min(1, similar_timing_success_rate)),
    channel_success_rate:        Math.max(0, Math.min(1, channel_success_rate)),
    recent_positive_feedback_rate: Math.max(0, Math.min(1, recent_positive_feedback_rate)),
  };
}

// ─── Main scoring function ────────────────────────────────────────────────────

export async function scoreAction(
  actionType: ActionType,
  insight: FusedInsight,
  ctx: EnrichedContext,
  agentName: string,
): Promise<ScoreBreakdown> {
  const [historicalSuccessRate, policyWeight] = await Promise.all([
    learningRepository.getOutcomeSuccessRate(ctx.business_id, agentName),
    learningRepository.getPolicyWeight(ctx.business_id, agentName, actionType),
  ]);

  const expected_roi = scoreExpectedRoi(actionType, insight, ctx);
  const business_fit = scoreBusinessFit(actionType, ctx.memory, ctx);
  const timing_fit   = scoreTimingFit(actionType, insight, ctx);

  const histComponents = buildHistoricalSuccessComponents(
    historicalSuccessRate, policyWeight, actionType, ctx,
  );
  const historical_success = computeHistoricalSuccessScore(histComponents);

  const finalScore = computeFinalActionScore({
    expected_roi,
    confidence:  insight.confidence,
    business_fit,
    timing_fit,
    historical_success,
  });

  const breakdown: ScoreBreakdown = {
    expected_roi:       Math.round(expected_roi * 100) / 100,
    confidence:         Math.round(insight.confidence * 100) / 100,
    business_fit:       Math.round(business_fit * 100) / 100,
    timing_fit:         Math.round(timing_fit * 100) / 100,
    historical_success: Math.round(historical_success * 100) / 100,
    final_score:        finalScore,
  };

  logger.debug('Action scored', {
    actionType, agentName, policyVersion: POLICY_VERSION, ...breakdown,
  });
  return breakdown;
}

/** Determine execution mode from score, action type, settings, and PolicyEngine */
export function determineExecutionMode(
  score: number,
  actionType: ActionType,
  autoExecuteEnabled: boolean,
  ctx: EnrichedContext,
): ExecutionMode {
  const channel = ACTION_TO_CHANNEL[actionType];

  // Always suggest for alerts
  if (actionType === 'alert') return 'suggest';

  // Find recent rejection/ignore timestamps
  const recentRejected = ctx.recent_decisions
    .filter(d => d.action_type === actionType && d.status === 'rejected')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const policyCtx = {
    businessId:           ctx.business_id,
    actionType,
    channel,
    confidence:           ctx.meta_configuration?.min_confidence_threshold ?? 0.5,
    finalScore:           score,
    autoEnabled:          autoExecuteEnabled,
    lastRejectedAt:       recentRejected?.created_at ?? null,
    lastIgnoredAt:        null,
    lastOverrideAt:       null,
    recentRejectionCount: ctx.recent_decisions.filter(d => d.action_type === actionType && d.status === 'rejected').length,
    overrideCount:        0,
    isCustomerFacing:     APPROVAL_REQUIRED_CHANNELS.has(channel),
    hasDraftContent:      score >= POLICY_THRESHOLDS.draft_min_score,
  };

  const result = policyEngine.evaluate(policyCtx);
  return result.executionMode;
}
