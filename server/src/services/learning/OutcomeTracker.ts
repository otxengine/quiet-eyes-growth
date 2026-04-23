/**
 * OutcomeTracker — captures and processes action outcomes.
 *
 * An outcome is recorded when:
 * - A user marks a recommendation as done/failed
 * - An automated action execution completes
 * - Revenue data is linked back to a decision
 *
 * On outcome recording:
 * 1. Saves to otx_outcome_events
 * 2. Updates policy weights via PolicyWeightUpdater
 * 3. Updates AgentLearningProfile
 * 4. Emits outcome.recorded event
 */

import { nanoid } from 'nanoid';
import { OutcomeEvent } from '../../models';
import { learningRepository } from '../../repositories/LearningRepository';
import { decisionRepository } from '../../repositories/DecisionRepository';
import { updateWeightFromOutcome } from './PolicyWeightUpdater';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';
import { prisma } from '../../db';

const logger = createLogger('OutcomeTracker');

export async function recordOutcome(params: {
  decisionId:    string;
  businessId:    string;
  agentName:     string;
  result:        'success' | 'failure' | 'partial';
  revenueImpact: number | null;
  notes:         string;
  traceId:       string;
}): Promise<OutcomeEvent> {
  const outcomeId = `out_${nanoid(12)}`;

  const now = new Date().toISOString();
  const outcome: OutcomeEvent = {
    id:                outcomeId,
    decision_id:       params.decisionId,
    business_id:       params.businessId,
    execution_task_id: null,
    agent_name:        params.agentName,
    outcome_type:      params.result === 'success' ? 'manual_mark' : 'manual_mark',
    outcome_score:     params.result === 'success' ? 1.0 : params.result === 'partial' ? 0.5 : 0.0,
    result:            params.result,
    revenue_impact:    params.revenueImpact,
    conversion_flag:   false,
    notes:             params.notes,
    timestamp:         now,
    created_at:        now,
  };

  logger.info('Recording outcome', {
    outcomeId,
    decisionId: params.decisionId,
    result: params.result,
    revenueImpact: params.revenueImpact,
  });

  // Save to DB
  await learningRepository.saveOutcome(outcome);

  // Retrieve decision for action type
  const decision = await decisionRepository.getDecisionById(params.decisionId);
  const actionType = decision?.action_type ?? 'general';

  // Update policy weights
  await updateWeightFromOutcome(
    params.businessId,
    params.agentName,
    actionType,
    params.result === 'success',
    params.revenueImpact,
    params.traceId,
  );

  // Also log to existing OutcomeLog table (compatibility with UI)
  await prisma.outcomeLog.create({
    data: {
      linked_business:      params.businessId,
      action_type:          actionType,
      was_accepted:         params.result === 'success',
      outcome_description:  `${params.agentName}: ${params.result}. ${params.notes}`.slice(0, 500),
      impact_score:         params.revenueImpact ?? undefined,
      created_at:           new Date().toISOString(),
    },
  }).catch(e => logger.warn('OutcomeLog write failed', { error: e.message }));

  // Emit event — matches OutcomeRecordedPayload in contracts.ts
  await bus.emit(bus.makeEvent('outcome.recorded', params.businessId, {
    event_id:         `evt_${nanoid(8)}`,
    outcome_event_id: outcomeId,
    business_id:      params.businessId,
    decision_id:      params.decisionId,
    outcome_type:     params.result === 'success' ? 'auto_execution' : 'manual_mark',
    outcome_score:    outcome.outcome_score,
  }, params.traceId));

  return outcome;
}

/** Bulk outcome summary for a business (last 30 days) */
export async function getOutcomeSummary(businessId: string): Promise<{
  total: number;
  success_rate: number;
  total_revenue_impact: number;
  by_agent: Record<string, { total: number; success_rate: number }>;
}> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      agent_name: string;
      total: number;
      success_count: number;
      revenue: number | null;
    }>>(
      `SELECT
         agent_name,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE result = 'success')::int AS success_count,
         SUM(revenue_impact)::numeric AS revenue
       FROM otx_outcome_events
       WHERE business_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY agent_name`,
      businessId,
    );

    const totalItems  = rows.reduce((s, r) => s + (r.total || 0), 0);
    const totalSuccess = rows.reduce((s, r) => s + (r.success_count || 0), 0);
    const totalRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);

    const byAgent: Record<string, { total: number; success_rate: number }> = {};
    for (const r of rows) {
      byAgent[r.agent_name] = {
        total: r.total,
        success_rate: r.total > 0 ? r.success_count / r.total : 0,
      };
    }

    return {
      total:                totalItems,
      success_rate:         totalItems > 0 ? totalSuccess / totalItems : 0,
      total_revenue_impact: totalRevenue,
      by_agent:             byAgent,
    };
  } catch {
    return { total: 0, success_rate: 0, total_revenue_impact: 0, by_agent: {} };
  }
}
