/**
 * PolicyWeightUpdater — updates agent policy weights after outcomes and feedback.
 *
 * LEARNING RULES — all coefficients from src/infra/config.ts:
 *
 * Feedback triggers:
 *   thumbs_up           → positiveWeightUpdate (α = 0.08)
 *   thumbs_down         → negativeWeightUpdate (β = 0.10)
 *   correction          → negativeWeightUpdate (β = 0.10)
 *   repeated_rejection  → negativeWeightUpdate (β × 1.5)
 *   edit (heavy)        → partial: old - 0.5 × β × old
 *   manual_override     → overrideConfidenceUpdate (ε = 0.07) + mild neg weight
 *   ignore (timeout)    → ignoredWeightUpdate (δ = 0.03)
 *
 * Outcome triggers:
 *   success             → outcomeSuccessUpdate (η = 0.12)
 *   failure             → outcomeFailureUpdate (θ = 0.10)
 *   conversion_flag     → outcomeSuccessUpdate with η × 1.5
 *   revenue > 1000 ILS  → +0.1 bonus to outcome_score
 *   revenue < 0         → -0.1 penalty to outcome_score
 *
 * All updates write to otx_weight_update_log for explainability.
 * Policy version is stamped on every weight record.
 */

import { nanoid } from 'nanoid';
import { learningRepository } from '../../repositories/LearningRepository';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';
import { PolicyWeight, WeightUpdateLog } from '../../models';
import { prisma } from '../../db';
import {
  LEARNING_COEFFICIENTS,
  WEIGHT_BOUNDS,
  POLICY_VERSION,
} from '../../infra/config';
import {
  positiveWeightUpdate,
  negativeWeightUpdate,
  acceptedWeightUpdate,
  ignoredWeightUpdate,
  overrideConfidenceUpdate,
  outcomeSuccessUpdate,
  outcomeFailureUpdate,
} from '../../learning/learning.formulas';

const logger = createLogger('PolicyWeightUpdater');

// ─── Write explainable update log ─────────────────────────────────────────────

async function logWeightUpdate(entry: WeightUpdateLog): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO otx_weight_update_log
         (id, business_id, agent_name, action_type, old_weight, new_weight,
          trigger_type, trigger_id, delta, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)
       ON CONFLICT DO NOTHING`,
      entry.id, entry.business_id, entry.agent_name, entry.action_type,
      entry.old_weight, entry.new_weight, entry.trigger_type,
      entry.trigger_id, entry.delta, entry.reason,
      entry.created_at,
    );
  } catch { /* table may not exist yet */ }
}

// ─── Shared persistence ───────────────────────────────────────────────────────

async function persistWeight(params: {
  businessId:  string;
  agentName:   string;
  actionType:  string;
  oldWeight:   number;
  newWeight:   number;
  triggerType: WeightUpdateLog['trigger_type'];
  triggerId:   string | null;
  reason:      string;
  traceId:     string;
}): Promise<void> {
  const successRate = await learningRepository.getOutcomeSuccessRate(
    params.businessId, params.agentName,
  );

  await learningRepository.savePolicyWeight({
    agent_name:     params.agentName,
    action_type:    params.actionType,
    business_id:    params.businessId,
    weight:         params.newWeight,
    success_rate:   successRate,
    sample_size:    1,
    last_updated:   new Date().toISOString(),
    policy_version: Number(POLICY_VERSION.split('.')[0]),
  } as any);

  const logEntry: WeightUpdateLog = {
    id:           `wlog_${nanoid(10)}`,
    business_id:  params.businessId,
    agent_name:   params.agentName,
    action_type:  params.actionType,
    old_weight:   Math.round(params.oldWeight * 10000) / 10000,
    new_weight:   Math.round(params.newWeight * 10000) / 10000,
    trigger_type: params.triggerType,
    trigger_id:   params.triggerId,
    delta:        Math.round((params.newWeight - params.oldWeight) * 10000) / 10000,
    reason:       params.reason,
    created_at:   new Date().toISOString(),
  };

  await logWeightUpdate(logEntry);

  logger.debug('Weight updated', {
    agentName:  params.agentName,
    actionType: params.actionType,
    old:        params.oldWeight,
    new:        params.newWeight,
    trigger:    params.triggerType,
    policyVersion: POLICY_VERSION,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type FeedbackTrigger =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'correction'
  | 'repeated_rejection'
  | 'edit'
  | 'manual_override'
  | 'ignore';

export async function updateWeightFromFeedback(
  businessId:  string,
  agentName:   string,
  actionType:  string,
  score:       number,          // -1 | 0 | 1
  traceId:     string,
  trigger:     FeedbackTrigger = score > 0 ? 'thumbs_up' : score < 0 ? 'thumbs_down' : 'ignore',
  triggerId?:  string,
): Promise<void> {
  if (score === 0 && trigger === 'ignore') return;  // neutral with no signal → skip

  const oldWeight = await learningRepository.getPolicyWeight(businessId, agentName, actionType);
  let newWeight: number;
  let reason: string;

  switch (trigger) {
    case 'thumbs_up':
      newWeight = positiveWeightUpdate(oldWeight, LEARNING_COEFFICIENTS.alpha);
      reason    = `positive feedback (α=${LEARNING_COEFFICIENTS.alpha})`;
      break;

    case 'thumbs_down':
      newWeight = negativeWeightUpdate(oldWeight, LEARNING_COEFFICIENTS.beta);
      reason    = `negative feedback (β=${LEARNING_COEFFICIENTS.beta})`;
      break;

    case 'correction':
      newWeight = negativeWeightUpdate(oldWeight, LEARNING_COEFFICIENTS.beta);
      reason    = `user provided correction (β=${LEARNING_COEFFICIENTS.beta})`;
      break;

    case 'repeated_rejection': {
      // 1.5× penalty for repeated rejection
      const strongBeta = LEARNING_COEFFICIENTS.beta * 1.5;
      newWeight = negativeWeightUpdate(oldWeight, strongBeta);
      reason    = `repeated rejection — strong penalty (β×1.5=${strongBeta.toFixed(3)})`;
      break;
    }

    case 'edit': {
      // Half-beta: partial rejection
      const halfBeta = LEARNING_COEFFICIENTS.beta * 0.5;
      newWeight = negativeWeightUpdate(oldWeight, halfBeta);
      reason    = `heavy edit = partial rejection (β×0.5=${halfBeta.toFixed(3)})`;
      break;
    }

    case 'manual_override':
      // Mild weight reduction + confidence penalty (handled in BusinessMemoryEngine)
      newWeight = negativeWeightUpdate(oldWeight, LEARNING_COEFFICIENTS.delta);
      reason    = `manual override — reduce confidence (δ=${LEARNING_COEFFICIENTS.delta})`;
      break;

    case 'ignore':
      newWeight = ignoredWeightUpdate(oldWeight, LEARNING_COEFFICIENTS.delta);
      reason    = `ignored after timeout (δ=${LEARNING_COEFFICIENTS.delta})`;
      break;

    default:
      newWeight = score > 0
        ? positiveWeightUpdate(oldWeight)
        : negativeWeightUpdate(oldWeight);
      reason = 'feedback';
  }

  await persistWeight({
    businessId, agentName, actionType, oldWeight, newWeight,
    triggerType: 'feedback', triggerId: triggerId ?? null,
    reason, traceId,
  });
}

export async function updateWeightFromOutcome(
  businessId:    string,
  agentName:     string,
  actionType:    string,
  success:       boolean,
  revenueImpact: number | null,
  traceId:       string,
  conversionFlag: boolean = false,
  outcomeId?:    string,
): Promise<void> {
  const oldWeight = await learningRepository.getPolicyWeight(businessId, agentName, actionType);

  // Base outcome score
  let outcomeScore = success ? 1.0 : 0.0;
  let reason: string;

  // Revenue calibration
  if (revenueImpact !== null) {
    if (revenueImpact > 1000) { outcomeScore = Math.min(1, outcomeScore + 0.1); }
    if (revenueImpact < 0)    { outcomeScore = Math.max(0, outcomeScore - 0.1); }
  }

  let newWeight: number;

  if (success) {
    if (conversionFlag) {
      // Conversion: η × 1.5
      const strongEta = LEARNING_COEFFICIENTS.eta * 1.5;
      newWeight = outcomeSuccessUpdate(oldWeight, outcomeScore, strongEta);
      reason    = `conversion — strong positive (η×1.5=${strongEta.toFixed(3)})`;
    } else {
      newWeight = outcomeSuccessUpdate(oldWeight, outcomeScore, LEARNING_COEFFICIENTS.eta);
      reason    = `successful execution (η=${LEARNING_COEFFICIENTS.eta})`;
    }
    if (revenueImpact !== null && revenueImpact > 1000) reason += ' +revenue_bonus';
  } else {
    newWeight = outcomeFailureUpdate(oldWeight, outcomeScore > 0 ? 1 - outcomeScore : 1.0, LEARNING_COEFFICIENTS.theta);
    reason    = `failed execution (θ=${LEARNING_COEFFICIENTS.theta})`;
    if (revenueImpact !== null && revenueImpact < 0) reason += ' -revenue_penalty';
  }

  await persistWeight({
    businessId, agentName, actionType, oldWeight, newWeight,
    triggerType: 'outcome', triggerId: outcomeId ?? null,
    reason, traceId,
  });
}

// ─── Full policy update cycle ─────────────────────────────────────────────────

export async function runPolicyUpdateCycle(
  businessId: string,
  traceId:    string,
): Promise<{ agents_updated: number; avg_accuracy_change: number; policy_version: number }> {
  logger.info('Running policy update cycle', { businessId });

  const profiles    = await learningRepository.getAllAgentProfiles(businessId);
  let agentsUpdated = 0;
  let totalChange   = 0;

  for (const profile of profiles) {
    if (!profile.agent_name) continue;

    const oldWeight = await learningRepository.getPolicyWeight(
      businessId, profile.agent_name, 'general',
    );

    const accuracy  = profile.accuracy_score ?? 0.5;
    // Use accepted rec formula with accuracy as the success factor
    const newWeight = acceptedWeightUpdate(oldWeight, accuracy, LEARNING_COEFFICIENTS.gamma);
    const delta     = Math.abs(newWeight - oldWeight);

    await learningRepository.savePolicyWeight({
      agent_name:     profile.agent_name,
      action_type:    'general',
      business_id:    businessId,
      weight:         newWeight,
      success_rate:   accuracy,
      sample_size:    profile.total_outputs ?? 0,
      last_updated:   new Date().toISOString(),
      policy_version: Number(POLICY_VERSION.split('.')[0]),
    } as any);

    await logWeightUpdate({
      id:           `wlog_${nanoid(10)}`,
      business_id:  businessId,
      agent_name:   profile.agent_name,
      action_type:  'general',
      old_weight:   oldWeight,
      new_weight:   newWeight,
      trigger_type: 'cycle',
      trigger_id:   null,
      delta,
      reason:       `policy cycle — accuracy=${accuracy.toFixed(3)} (γ=${LEARNING_COEFFICIENTS.gamma})`,
      created_at:   new Date().toISOString(),
    });

    agentsUpdated++;
    totalChange += delta;
  }

  const avgChange     = agentsUpdated > 0 ? totalChange / agentsUpdated : 0;
  const policyVer     = Number(POLICY_VERSION.split('.')[0]);

  await bus.emit(bus.makeEvent('weights.updated', businessId, {
    business_id:         businessId,
    agents_updated:      agentsUpdated,
    avg_accuracy_change: avgChange,
    policy_version:      policyVer,
  }, traceId));

  logger.info('Policy cycle complete', { businessId, agentsUpdated, avgChange, policyVersion: POLICY_VERSION });

  return {
    agents_updated:      agentsUpdated,
    avg_accuracy_change: Math.round(avgChange * 1000) / 1000,
    policy_version:      policyVer,
  };
}
