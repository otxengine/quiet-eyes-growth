/**
 * executionDecider.ts — OTX-003
 * Determines whether to auto-execute, present for approval, or discard
 * a candidate action based on confidence, predicted impact, and context.
 * Monitors outcomes and updates execution thresholds adaptively.
 */

import { prisma } from '../db';

export type ExecutionDecision = 'auto_execute' | 'present_for_approval' | 'discard';

export interface DecisionInput {
  businessId:     string;
  actionType:     string;    // 'social_post'|'review_reply'|'whatsapp_send'|'campaign'
  confidenceScore: number;  // 0–100 from signal scorer
  predictedImpact: 'high' | 'medium' | 'low';
  contextAttrs?: {
    hour?:       number;    // current hour (0–23) for posting_hours check
    hasToken?:   boolean;   // API token available for this channel
    riskLevel?:  'high' | 'low'; // 'high' risk actions always need approval
  };
}

export interface DecisionResult {
  decision:      ExecutionDecision;
  reason:        string;
  confidenceScore: number;
  predictedImpact: string;
  autoExecuteAt?: string;  // ISO — for semi_auto: when to auto-execute if not acted on
}

// ── Action risk classification ────────────────────────────────────────────────
// High-risk actions always require human approval regardless of confidence.
const HIGH_RISK_ACTIONS = new Set([
  'campaign',          // spending money
  'price_change',      // changing prices
  'public_statement',  // public-facing sensitive content
]);

// Low-risk actions can be auto-executed if confidence is high enough.
const LOW_RISK_ACTIONS = new Set([
  'social_post',
  'review_reply',
  'review_request',
]);

// ── Core decision function ────────────────────────────────────────────────────
export async function decide(input: DecisionInput): Promise<DecisionResult> {
  const { businessId, actionType, confidenceScore, predictedImpact, contextAttrs } = input;

  // Load business autonomy level + constraints
  const [profile, constraints] = await Promise.all([
    prisma.businessProfile.findFirst({ where: { id: businessId }, select: { autonomy_level: true } }),
    prisma.businessConstraints.findFirst({ where: { business_id: businessId } }).catch(() => null),
  ]);

  const autonomyLevel = profile?.autonomy_level || 'semi_auto';
  const minConfAuto    = constraints?.min_confidence_auto    ?? 85;
  const minConfSuggest = constraints?.min_confidence_suggest ?? 60;

  // 1. Always require approval for high-risk actions
  if (HIGH_RISK_ACTIONS.has(actionType) || contextAttrs?.riskLevel === 'high') {
    return {
      decision:       'present_for_approval',
      reason:         `High-risk action type "${actionType}" always requires human approval`,
      confidenceScore,
      predictedImpact,
    };
  }

  // 2. Manual mode — always present for approval
  if (autonomyLevel === 'manual') {
    return {
      decision:       'present_for_approval',
      reason:         'Business is in manual autonomy mode',
      confidenceScore,
      predictedImpact,
    };
  }

  // 3. Below suggestion threshold — discard
  if (confidenceScore < minConfSuggest) {
    return {
      decision:       'discard',
      reason:         `Confidence ${confidenceScore} below suggestion threshold ${minConfSuggest}`,
      confidenceScore,
      predictedImpact,
    };
  }

  // 4. Full-auto mode + high confidence + low-risk action → auto-execute
  if (
    autonomyLevel === 'full_auto' &&
    confidenceScore >= minConfAuto &&
    LOW_RISK_ACTIONS.has(actionType) &&
    contextAttrs?.hasToken !== false  // don't auto-execute if no API token
  ) {
    return {
      decision:       'auto_execute',
      reason:         `Full-auto mode, confidence ${confidenceScore} ≥ threshold ${minConfAuto}, low-risk action`,
      confidenceScore,
      predictedImpact,
    };
  }

  // 5. Semi-auto with high confidence → suggest with auto-execute timer (24h)
  if (autonomyLevel === 'semi_auto' && confidenceScore >= minConfAuto) {
    const autoAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    return {
      decision:       'present_for_approval',
      reason:         `Semi-auto: presenting for approval, will auto-execute if not acted on by ${autoAt}`,
      confidenceScore,
      predictedImpact,
      autoExecuteAt:  autoAt,
    };
  }

  // 6. Default: present for approval
  return {
    decision:       'present_for_approval',
    reason:         `Confidence ${confidenceScore} is within approval range (${minConfSuggest}–${minConfAuto})`,
    confidenceScore,
    predictedImpact,
  };
}

// ── Create AutoAction with decision attached ──────────────────────────────────
export async function createActionWithDecision(params: {
  businessId:    string;
  agentName:     string;
  actionType:    string;
  description:   string;
  payload:       Record<string, any>;
  revenueImpact?: number;
  decisionInput: DecisionInput;
}): Promise<{ id: string; decision: DecisionResult }> {
  const { businessId, agentName, actionType, description, payload, revenueImpact, decisionInput } = params;

  const decisionResult = await decide(decisionInput);

  // Map decision to AutoAction status
  const statusMap: Record<ExecutionDecision, string> = {
    auto_execute:        'executing',
    present_for_approval: 'pending_approval',
    discard:             'rejected',
  };

  const action = await prisma.autoAction.create({
    data: {
      linked_business:    businessId,
      agent_name:         agentName,
      action_type:        actionType,
      description,
      payload:            JSON.stringify(payload),
      status:             statusMap[decisionResult.decision],
      revenue_impact:     revenueImpact || 0,
      auto_execute_at:    decisionResult.autoExecuteAt || null,
      confidence_score:   decisionResult.confidenceScore,
      predicted_impact:   decisionResult.predictedImpact,
      execution_decision: decisionResult.decision,
      decision_reason:    decisionResult.reason,
    },
  });

  return { id: action.id, decision: decisionResult };
}

// ── Outcome monitor: update thresholds based on observed results ──────────────
export async function recordOutcome(params: {
  businessId:  string;
  autoActionId: string;
  outcome:     'accepted' | 'rejected' | 'completed' | 'failed';
  impactScore?: number;  // observed ROI score 0–100
}) {
  const { businessId, autoActionId, outcome, impactScore } = params;

  try {
    // Update AutoAction with outcome score
    if (impactScore !== undefined) {
      await prisma.autoAction.update({
        where: { id: autoActionId },
        data:  { outcome_score: impactScore },
      });
    }

    // Store in OutcomeLog for trend analysis
    await prisma.outcomeLog.create({
      data: {
        linked_business:     businessId,
        action_type:         'auto_action',
        was_accepted:        outcome === 'accepted' || outcome === 'completed',
        outcome_description: outcome,
        impact_score:        impactScore ?? null,
        linked_action:       autoActionId,
        created_at:          new Date().toISOString(),
      },
    });

    // Adaptive threshold update: if action was rejected often,
    // raise minConfidenceAuto slightly to be more conservative
    const recentOutcomes = await prisma.outcomeLog.findMany({
      where: {
        linked_business: businessId,
        action_type:     'auto_action',
        created_at:      { gte: new Date(Date.now() - 30 * 86400000).toISOString() },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    if (recentOutcomes.length >= 5) {
      const acceptRate = recentOutcomes.filter(o => o.was_accepted).length / recentOutcomes.length;
      const constraints = await prisma.businessConstraints.findFirst({
        where: { business_id: businessId },
      });

      if (constraints) {
        let minConfAuto = constraints.min_confidence_auto ?? 85;
        // Adjust threshold based on accept rate
        if (acceptRate < 0.5 && minConfAuto < 95) minConfAuto += 2;  // too many rejections → raise bar
        if (acceptRate > 0.8 && minConfAuto > 75) minConfAuto -= 1;  // good track record → lower bar
        await prisma.businessConstraints.update({
          where: { business_id: businessId },
          data:  { min_confidence_auto: minConfAuto, updated_at: new Date().toISOString() },
        });
      }
    }
  } catch (err: any) {
    console.error('[executionDecider] recordOutcome error:', err.message);
  }
}
