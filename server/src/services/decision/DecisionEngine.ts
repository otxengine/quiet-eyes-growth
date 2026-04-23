/**
 * DecisionEngine — Strategy & Decision Layer
 *
 * Input:  EnrichedContext + FusedInsight
 * Output: Decision[]  (ranked, up to 3 concurrent)
 *
 * Pipeline:
 * 1. Generate candidate action types from insight urgency + opportunity/threat types
 * 2. Run PolicyGate eligibility checks (novelty, confidence, dedup, impact)
 * 3. Score each eligible candidate via ActionScoringService
 * 4. Filter rejected patterns from memory
 * 5. Compute priority (weighted urgency + fit + roi + history)
 * 6. Cap at MAX_CONCURRENT_DECISIONS = 3
 * 7. Persist + emit decision.created events
 *
 * IDEMPOTENCY: unique per (business_id, fused_insight_id, action_type, policy_version)
 */

import { nanoid } from 'nanoid';
import {
  EnrichedContext, FusedInsight, Decision, ActionType, DecisionStatus,
} from '../../models';
import { scoreAction, determineExecutionMode } from './ActionScoringService';
import { decisionRepository } from '../../repositories/DecisionRepository';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';

const logger = createLogger('DecisionEngine');

const MAX_CONCURRENT_DECISIONS = 3;
const DECISION_TTL_HOURS       = 48;
const POLICY_VERSION           = 1;

// ─── Candidate mapping ─────────────────────────────────────────────────────────

const URGENCY_TO_CANDIDATES: Record<string, ActionType[]> = {
  critical: ['reputation', 'alert', 'retention', 'outreach'],
  high:     ['campaign', 'outreach', 'reputation', 'promotion'],
  medium:   ['content', 'campaign', 'pricing', 'expansion'],
  low:      ['content', 'expansion', 'competitor_response'],
};

// Map opportunity/threat types to most-relevant action types
const OPPORTUNITY_TYPE_TO_ACTION: Record<string, ActionType> = {
  lead_surge:           'outreach',
  reputation_recovery:  'reputation',
  competitor_gap:       'campaign',
  demand_spike:         'promotion',
  local_event:          'campaign',
  retention_risk:       'retention',
  pricing_opportunity:  'pricing',
  expansion_signal:     'expansion',
  seasonal_window:      'campaign',
  cross_sell:           'content',
};

const THREAT_TYPE_TO_ACTION: Record<string, ActionType> = {
  negative_review_spike: 'reputation',
  reputation_attack:     'reputation',
  competitor_promotion:  'competitor_response',
  lead_drop:             'campaign',
  demand_drop:           'promotion',
  price_undercut:        'pricing',
  service_gap:           'content',
};

const ACTION_TYPE_TO_AGENT: Record<ActionType, string> = {
  content:             'ContentAgent',
  campaign:            'CampaignAutopilot',
  promotion:           'CampaignAutopilot',
  outreach:            'OutreachAgent',
  reputation:          'ReputationWarRoom',
  retention:           'RetentionSentinel',
  pricing:             'NegotiationPricingCoach',
  expansion:           'ServiceExpansionScout',
  competitor_response: 'CompetitorSnapshot',
  alert:               'ProactiveAlerts',
};

// Base ROI by action type (empirical priors)
const BASE_ROI: Record<ActionType, number> = {
  promotion: 0.85, campaign: 0.80, outreach: 0.75, reputation: 0.78,
  pricing: 0.72, retention: 0.70, content: 0.65, expansion: 0.60,
  competitor_response: 0.55, alert: 0.50,
};

// ─── Policy eligibility gate ──────────────────────────────────────────────────

type EligibilityReason =
  | 'low_confidence'
  | 'low_novelty'
  | 'duplicate_active'
  | 'below_impact_threshold'
  | 'rejected_pattern';

interface EligibilityResult {
  eligible: boolean;
  reason?:  EligibilityReason;
}

function checkEligibility(
  actionType: ActionType,
  insight: FusedInsight,
  ctx: EnrichedContext,
  minConfidence: number,
): EligibilityResult {
  // 1. Confidence gate
  if (insight.confidence < minConfidence) {
    return { eligible: false, reason: 'low_confidence' };
  }

  // 2. Novelty gate — skip if all signals are stale/repeated
  const avgNovelty = (ctx.signals.items ?? [])
    .reduce((s, c) => s + c.novelty_score, 0) /
    Math.max(1, ctx.signals.items?.length ?? 0) || 0.5;
  // Only block if we actually have classified signals AND novelty is truly low
  if ((ctx.signals.items?.length ?? 0) > 0 && avgNovelty < 0.20) {
    return { eligible: false, reason: 'low_novelty' };
  }

  // 3. Duplicate active window check (same action_type active within 48h)
  const recentSame = ctx.recent_decisions.find(
    d => d.action_type === actionType &&
         !['rejected', 'learned', 'measured'].includes(d.status),
  );
  if (recentSame) {
    return { eligible: false, reason: 'duplicate_active' };
  }

  // 4. Impact threshold (base_roi × confidence must exceed floor)
  const baseRoi = BASE_ROI[actionType] ?? 0.5;
  if (baseRoi * insight.confidence < 0.15) {
    return { eligible: false, reason: 'below_impact_threshold' };
  }

  // 5. Rejected pattern check
  const memory = ctx.memory;
  if (memory?.rejected_patterns.some(p => p.toLowerCase().includes(actionType.toLowerCase()))) {
    return { eligible: false, reason: 'rejected_pattern' };
  }

  return { eligible: true };
}

// ─── Priority calculation ──────────────────────────────────────────────────────

function computePriority(
  finalScore: number,
  insight: FusedInsight,
  actionType: ActionType,
  ctx: EnrichedContext,
): number {
  const urgencyW: Record<string, number> = {
    low: 0.25, medium: 0.5, high: 0.75, critical: 1.0,
  };
  const urgency = urgencyW[insight.urgency] ?? 0.5;

  let priority = Math.round(finalScore * 0.5 + urgency * 50);

  // Downgrade for recently rejected similar actions
  const wasRejected = ctx.recent_decisions.some(
    d => d.action_type === actionType && d.status === 'rejected',
  );
  if (wasRejected) priority = Math.max(0, priority - 20);

  // Upgrade for recent positive outcomes of same type
  const hadSuccess = ctx.recent_outcomes.some(o => o.conversion_flag);
  if (hadSuccess) priority = Math.min(100, priority + 10);

  return Math.max(0, Math.min(100, priority));
}

// ─── Build candidate list (urgency + opportunities + threats) ─────────────────

function buildCandidates(insight: FusedInsight, ctx: EnrichedContext): ActionType[] {
  const seen = new Set<ActionType>();
  const ordered: ActionType[] = [];

  const add = (t: ActionType) => { if (!seen.has(t)) { seen.add(t); ordered.push(t); } };

  // From detected opportunities (highest signal fidelity)
  for (const opp of ctx.active_opportunities) {
    const action = OPPORTUNITY_TYPE_TO_ACTION[opp.type];
    if (action) add(action);
  }

  // From detected threats
  for (const thr of ctx.active_threats) {
    const action = THREAT_TYPE_TO_ACTION[thr.type];
    if (action) add(action);
  }

  // From suggested_action_types in the fused insight
  for (const t of (insight.suggested_action_types ?? [])) add(t);

  // From urgency fallback
  for (const t of (URGENCY_TO_CANDIDATES[insight.urgency] ?? ['content', 'alert'])) add(t);

  return ordered;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function makeDecisions(
  ctx: EnrichedContext,
  insight: FusedInsight,
): Promise<Decision[]> {
  logger.info('Making decisions', {
    businessId:   ctx.business_id,
    insightId:    insight.id,
    urgency:      insight.urgency,
    opportunities: ctx.active_opportunities.length,
    threats:       ctx.active_threats.length,
  });

  const minConf        = ctx.meta_configuration?.min_confidence_threshold ?? 0.30;
  const minScore       = ctx.meta_configuration?.min_score_threshold ?? 30;
  const autoEnabled    = ctx.meta_configuration?.auto_execute_enabled ?? false;
  const candidates     = buildCandidates(insight, ctx);
  const decisions: Decision[] = [];

  for (const actionType of candidates) {
    if (decisions.length >= MAX_CONCURRENT_DECISIONS) break;

    // Eligibility gate
    const elig = checkEligibility(actionType, insight, ctx, minConf);
    if (!elig.eligible) {
      logger.debug('Decision eligibility failed', {
        actionType, reason: elig.reason, businessId: ctx.business_id,
      });

      await bus.emit(bus.makeEvent('decision.eligibility_failed', ctx.business_id, {
        event_id:    `evt_${nanoid(8)}`,
        business_id: ctx.business_id,
        insight_id:  insight.id,
        action_type: actionType,
        reason:      elig.reason!,
      }, ctx.trace_id ?? '')).catch(() => {});

      continue;
    }

    const agentName  = ACTION_TYPE_TO_AGENT[actionType];
    const breakdown  = await scoreAction(actionType, insight, ctx, agentName);

    // Minimum score threshold
    if (breakdown.final_score < minScore) {
      logger.debug('Score below threshold, skipping', {
        actionType, score: breakdown.final_score,
      });
      continue;
    }

    const executionMode = determineExecutionMode(
      breakdown.final_score, actionType, autoEnabled, ctx,
    );

    const approvalRequired =
      executionMode === 'approval' ||
      (ctx.meta_configuration?.approval_required_channels ?? [])
        .includes(actionType);

    const priority   = computePriority(breakdown.final_score, insight, actionType, ctx);
    const decisionId = `dec_${nanoid(12)}`;
    const expiresAt  = new Date(Date.now() + DECISION_TTL_HOURS * 3_600_000).toISOString();
    const now        = new Date().toISOString();

    const decision: Decision = {
      id:                 decisionId,
      business_id:        ctx.business_id,
      fused_insight_id:   insight.id,
      insight_id:         insight.id,
      trace_id:           ctx.trace_id ?? '',
      action_type:        actionType,
      chosen_action_type: actionType,
      title:              buildDecisionTitle(actionType, insight),
      decision_reasoning: insight.explanation || insight.top_opportunity,
      reasoning:          insight.explanation || insight.top_opportunity,
      priority,
      score:              breakdown.final_score,
      score_breakdown:    breakdown,
      confidence:         insight.confidence,
      expected_roi:       breakdown.expected_roi,
      execution_mode:     executionMode,
      approval_required:  approvalRequired,
      policy_version:     POLICY_VERSION,
      status:             'created' as DecisionStatus,
      tags:               buildTags(actionType, insight, ctx),
      context_snapshot:   JSON.stringify({
        urgency:      insight.urgency,
        top_opp:      insight.top_opportunity.slice(0, 100),
        health_score: ctx.health_score,
        hot_leads:    ctx.leads.hot,
        neg_reviews:  ctx.reviews.negative_last7d,
        opportunities: ctx.active_opportunities.map(o => o.type),
        threats:       ctx.active_threats.map(t => t.type),
      }),
      created_at: now,
      expires_at: expiresAt,
    };

    decisions.push(decision);
    await decisionRepository.saveDecision(decision);

    await bus.emit(bus.makeEvent('decision.created', ctx.business_id, {
      event_id:           `evt_${nanoid(8)}`,
      decision_id:        decisionId,
      business_id:        ctx.business_id,
      chosen_action_type: actionType,
      priority,
      confidence:         insight.confidence,
      execution_mode:     executionMode,
    }, ctx.trace_id ?? ''));

    logger.info('Decision created', {
      decisionId, actionType, score: breakdown.final_score,
      priority, executionMode, approvalRequired,
    });
  }

  return decisions.sort((a, b) => b.score - a.score);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDecisionTitle(actionType: ActionType, insight: FusedInsight): string {
  const titles: Record<ActionType, string> = {
    content:             `צור תוכן: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    campaign:            `הפעל קמפיין: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    promotion:           `הפעל מבצע: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    outreach:            `פנה ללידים: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    reputation:          `טפל במוניטין: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    retention:           `שמור לקוחות: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    pricing:             `עדכן תמחור: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    expansion:           `הרחב שירותים: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    competitor_response: `הגב למתחרה: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
    alert:               `התראה: ${insight.top_summary?.slice(0, 50) ?? insight.top_opportunity.slice(0, 50)}`,
  };
  return titles[actionType] || insight.top_opportunity.slice(0, 80);
}

function buildTags(
  actionType: ActionType,
  insight: FusedInsight,
  ctx: EnrichedContext,
): string[] {
  const tags: string[] = [actionType, insight.urgency];
  if (ctx.leads.hot > 0) tags.push('hot_leads');
  if (ctx.reviews.negative_last7d > 0) tags.push('reputation_risk');
  if (insight.confidence > 0.8) tags.push('high_confidence');
  if (ctx.memory?.preferred_tone) tags.push(`tone_${ctx.memory.preferred_tone}`);
  if (ctx.active_opportunities.length > 0) tags.push('has_opportunity');
  if (ctx.active_threats.length > 0) tags.push('has_threat');
  return tags;
}
