/**
 * EventChoreographer — explicit handler contracts for all event trigger chains.
 *
 * Four canonical chains:
 *   A. Signal → Opportunity        (signal.classified → opportunity.detected → context.built → insight.fused)
 *   B. Event → Opportunity         (event.raw.collected → event.opportunity.created → opportunity.detected)
 *   C. Forecast → Decision         (forecast.updated → context.built → insight.fused → decision.created → recommendation.generated)
 *   D. Execution → Learning        (execution.completed → feedback.received → memory.updated → weights.updated)
 *
 * Every handler contract specifies:
 *   - trigger: the event type that fires it
 *   - condition: predicate to gate firing (returns false → skip)
 *   - handler: async function executed on trigger
 *   - onError: 'log' | 'retry' | 'dead_letter'
 */

import { bus } from './EventBus';
import {
  OTXEventType,
  OTXEvent,
  SignalClassifiedPayload,
  OpportunityDetectedPayload,
  ThreatDetectedPayload,
  InsightFusedPayload,
  DecisionCreatedPayload,
  RecommendationGeneratedPayload,
  ExecutionCompletedPayload,
  FeedbackReceivedPayload,
  OutcomeRecordedPayload,
  MemoryUpdatedPayload,
  ForecastUpdatedPayload,
  ExecutionApprovalRequiredPayload,
  CompetitorChangePayload,
  DemandSpikePayload,
  ChurnRiskDetectedPayload,
} from './contracts';
import { createLogger } from '../infra/logger';
import { resolveRoute } from '../routing/RoutingRuleTable';

const logger = createLogger('EventChoreographer');

// ─── Event-triggered pipeline runner ─────────────────────────────────────────
// Lazy import to avoid circular dependency (MasterOrchestrator → EventBus → EventChoreographer)
// Per-business cooldown: max 1 event-triggered run per event type per 3 minutes
const eventCooldowns = new Map<string, number>(); // `${businessId}:${eventType}` → timestamp

async function triggerEventPipeline(
  eventType: OTXEventType,
  businessId: string,
  payload: Record<string, unknown>,
  traceId: string,
): Promise<void> {
  const cooldownKey = `${businessId}:${eventType}`;
  const last = eventCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - last < 3 * 60_000) {
    logger.debug(`[EventChoreographer] cooldown active for ${eventType}`, { businessId });
    return;
  }
  eventCooldowns.set(cooldownKey, Date.now());

  const resolution = resolveRoute(eventType, payload);
  if (!resolution) {
    logger.debug(`[EventChoreographer] no routing rule matched for ${eventType}`, { businessId });
    return;
  }

  logger.info(`[EventChoreographer] routing rule matched: ${resolution.rule.id}`, {
    eventType,
    businessId,
    stages_to_run:  resolution.stages_to_run,
    stages_to_skip: resolution.stages_to_skip,
    trace_id: traceId,
  });

  try {
    // Lazy import to break circular dep
    const { runPipeline } = await import('../orchestration/MasterOrchestrator');
    await runPipeline(businessId, {
      mode:            'event_triggered',
      triggeredBy:     'event',
      skipStages:      resolution.stages_to_skip,
      forceRun:        false,
      sourceEventType: eventType,
      ruleId:          resolution.rule.id,
    });
  } catch (err: any) {
    logger.error(`[EventChoreographer] event-triggered pipeline failed`, {
      eventType, businessId, error: err.message,
    });
  }
}

// ─── Handler Contract ─────────────────────────────────────────────────────────

export interface HandlerContract<TPayload = unknown> {
  name:        string;
  trigger:     OTXEventType;
  description: string;
  condition:   (event: OTXEvent<TPayload>) => boolean;
  handler:     (event: OTXEvent<TPayload>) => Promise<void>;
  onError:     'log' | 'retry' | 'dead_letter';
  chain:       'A' | 'B' | 'C' | 'D' | 'multi';
}

// Registry of all registered contracts (for introspection)
const registeredContracts: HandlerContract[] = [];

function register<T>(contract: HandlerContract<T>): void {
  registeredContracts.push(contract as HandlerContract);
  bus.on<T>(contract.trigger, async (event) => {
    try {
      if (!contract.condition(event as OTXEvent<T>)) {
        logger.debug(`[${contract.name}] condition not met — skipped`, {
          trace_id: event.trace_id,
          type: event.type,
        });
        return;
      }
      await contract.handler(event as OTXEvent<T>);
    } catch (err: any) {
      logger.error(`[${contract.name}] handler error`, {
        error:    err.message,
        trace_id: event.trace_id,
        type:     event.type,
        policy:   contract.onError,
      });
      if (contract.onError === 'dead_letter') {
        // In production: push to DLQ (Redis list, SQS DLQ, etc.)
        logger.warn(`[${contract.name}] dead-lettered`, { event_id: event.event_id });
      }
      // 'retry' would be handled by a retry queue — see PriorityQueue.ts
    }
  });
}

// ─── Chain A: Signal → Opportunity ────────────────────────────────────────────
// signal.classified → opportunity.detected → [context rebuild triggered upstream]

const chainA_signalToOpportunity: HandlerContract<SignalClassifiedPayload> = {
  name:        'signal_classified→opportunity_detector',
  trigger:     'signal.classified',
  description: 'When a signal is classified with sufficient relevance, activate relevant pipeline stages via routing rule table.',
  chain:       'A',
  onError:     'log',
  condition:   (event) => {
    const p = event.payload;
    return p.relevance_score >= 0.3 && p.confidence >= 0.3;
  },
  handler: async (event) => {
    const p = event.payload;
    logger.debug('Chain A: signal classified → routing rule evaluation', {
      signal_id: p.signal_id,
      trace_id:  event.trace_id,
      relevance: p.relevance_score,
    });
    await triggerEventPipeline(
      'signal.classified',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

const chainA_opportunityDetected: HandlerContract<OpportunityDetectedPayload> = {
  name:        'opportunity_detected→log_new',
  trigger:     'opportunity.detected',
  description: 'Log new vs merged opportunity detections for observability.',
  chain:       'A',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    const p = event.payload;
    logger.info(`Chain A: opportunity ${p.is_new ? 'NEW' : 'MERGED'}`, {
      opportunity_id: p.opportunity_id,
      type:           p.type,
      score:          p.opportunity_score,
      urgency:        p.urgency,
      trace_id:       event.trace_id,
    });
  },
};

// ─── Chain B: Event → Opportunity ─────────────────────────────────────────────
// event.raw.collected → event.opportunity.created → opportunity.detected

const chainB_eventToOpportunity: HandlerContract = {
  name:        'event_raw→opportunity_check',
  trigger:     'event.raw.collected',
  description: 'Raw external events (holidays, market events) may surface opportunities.',
  chain:       'B',
  onError:     'log',
  condition:   (event) => {
    // All raw events are candidates; EventOpportunityDetector will filter
    return !!event.entity_id;
  },
  handler: async (event) => {
    logger.debug('Chain B: event.raw.collected received', {
      entity_id: event.entity_id,
      trace_id:  event.trace_id,
    });
    // EventOpportunityDetector processes this and may emit event.opportunity.created
  },
};

// ─── Chain C: Forecast → Decision ─────────────────────────────────────────────
// forecast.updated → context.built → insight.fused → decision.created → recommendation.generated

const chainC_forecastToDecision: HandlerContract<ForecastUpdatedPayload> = {
  name:        'forecast_updated→trigger_context',
  trigger:     'forecast.updated',
  description: 'Significant forecast updates trigger context rebuild and re-fusion via routing rule table.',
  chain:       'C',
  onError:     'log',
  condition:   (event) => {
    return event.payload.confidence >= 0.55 && event.payload.expected_demand_score >= 0.4;
  },
  handler: async (event) => {
    const p = event.payload;
    logger.info('Chain C: forecast update → routing rule evaluation', {
      forecast_id: p.forecast_id,
      business_id: p.business_id,
      confidence:  p.confidence,
      trace_id:    event.trace_id,
    });
    await triggerEventPipeline(
      'forecast.updated',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

const chainC_insightFused: HandlerContract<InsightFusedPayload> = {
  name:        'insight_fused→decision_gate',
  trigger:     'insight.fused',
  description: 'Critical fused insights fast-track to decide+dispatch via routing rule table.',
  chain:       'C',
  onError:     'log',
  condition:   (event) => event.payload.confidence >= 0.30,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Chain C: insight fused → routing rule evaluation', {
      insight_id:   p.fused_insight_id,
      urgency:      p.urgency,
      primary_type: p.primary_type,
      confidence:   p.confidence,
      trace_id:     event.trace_id,
    });
    // Only critical insights trigger a new pipeline run (non-critical already in a running pipeline)
    if (p.urgency === 'critical') {
      await triggerEventPipeline(
        'insight.fused',
        event.entity_id,
        p as unknown as Record<string, unknown>,
        event.trace_id,
      );
    }
  },
};

const chainC_decisionCreated: HandlerContract<DecisionCreatedPayload> = {
  name:        'decision_created→recommendation_gate',
  trigger:     'decision.created',
  description: 'Log decision creation with execution mode for monitoring.',
  chain:       'C',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Chain C: decision created', {
      decision_id:    p.decision_id,
      action_type:    p.chosen_action_type,
      execution_mode: p.execution_mode,
      priority:       p.priority,
      trace_id:       event.trace_id,
    });
  },
};

const chainC_recommendationGenerated: HandlerContract<RecommendationGeneratedPayload> = {
  name:        'recommendation_generated→ready_for_execution',
  trigger:     'recommendation.generated',
  description: 'Recommendation is the final handoff to execution layer.',
  chain:       'C',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    logger.info('Chain C: recommendation ready for execution', {
      recommendation_id: event.payload.recommendation_id,
      decision_id:       event.payload.decision_id,
      trace_id:          event.trace_id,
    });
  },
};

// ─── Chain D: Execution → Learning ────────────────────────────────────────────
// execution.completed → feedback.received → memory.updated → weights.updated

const chainD_executionCompleted: HandlerContract<ExecutionCompletedPayload> = {
  name:        'execution_completed→learning_trigger',
  trigger:     'execution.completed',
  description: 'Completed executions trigger the learning stage via routing rule table.',
  chain:       'D',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Chain D: execution completed → learning cycle via routing', {
      task_id:  p.execution_task_id,
      status:   p.result_status,
      trace_id: event.trace_id,
    });
    await triggerEventPipeline(
      'execution.completed',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

const chainD_feedbackReceived: HandlerContract<FeedbackReceivedPayload> = {
  name:        'feedback_received→memory_update',
  trigger:     'feedback.received',
  description: 'User feedback triggers immediate memory update + weight recalibration.',
  chain:       'D',
  onError:     'log',
  condition:   (event) => {
    // Only process actionable feedback types
    const actionable = ['thumbs_up', 'thumbs_down', 'ignored', 'accepted', 'manual_override'];
    return actionable.includes(event.payload.feedback_type);
  },
  handler: async (event) => {
    logger.info('Chain D: feedback → memory update queued', {
      feedback_id:   event.payload.feedback_event_id,
      feedback_type: event.payload.feedback_type,
      output_type:   event.payload.output_type,
      trace_id:      event.trace_id,
    });
  },
};

const chainD_memoryUpdated: HandlerContract<MemoryUpdatedPayload> = {
  name:        'memory_updated→weights_update',
  trigger:     'memory.updated',
  description: 'Memory update triggers policy weight recalibration.',
  chain:       'D',
  onError:     'log',
  condition:   (event) => event.payload.update_type === 'full_cycle',
  handler: async (event) => {
    logger.info('Chain D: memory updated → triggering weight recalibration', {
      business_id:    event.payload.business_id,
      memory_version: event.payload.memory_version,
      trace_id:       event.trace_id,
    });
  },
};

// ─── Cross-chain: Approval required ───────────────────────────────────────────

const approvalRequiredContract: HandlerContract<ExecutionApprovalRequiredPayload> = {
  name:        'execution_approval_required→notify',
  trigger:     'execution.approval_required',
  description: 'When approval is required, notify relevant approvers and log.',
  chain:       'multi',
  onError:     'dead_letter',
  condition:   (_event) => true,
  handler: async (event) => {
    const p = event.payload;
    logger.warn('Approval required — awaiting human decision', {
      task_id:           p.execution_task_id,
      decision_id:       p.decision_id,
      channel:           p.channel,
      recommendation_id: p.recommendation_id,
      trace_id:          event.trace_id,
    });
    // In production: send notification via webhook, email, or in-app alert
    // ApprovalWorkflow.createApprovalRequest() is called by ActionDispatcher
  },
};

// ─── Threat handling contract ─────────────────────────────────────────────────

const threatDetectedContract: HandlerContract<ThreatDetectedPayload> = {
  name:        'threat_detected→route_and_escalate',
  trigger:     'threat.detected',
  description: 'New threats are routed via rule table; high-risk threats trigger immediate pipeline dispatch.',
  chain:       'multi',
  onError:     'dead_letter',
  condition:   (event) => event.payload.is_new,
  handler: async (event) => {
    const p = event.payload;
    logger.warn('Threat detected → routing rule evaluation', {
      threat_id:  p.threat_id,
      type:       p.type,
      risk_score: p.risk_score,
      urgency:    p.urgency,
      trace_id:   event.trace_id,
    });
    await triggerEventPipeline(
      'threat.detected',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

// ─── Competitor change → routing ──────────────────────────────────────────────
const competitorChangeContract: HandlerContract<CompetitorChangePayload> = {
  name:        'competitor_change→route',
  trigger:     'competitor.change.detected',
  description: 'Competitor changes are evaluated by rule table and route to relevant pipeline stages.',
  chain:       'A',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Competitor change detected → routing', {
      competitor_id: p.competitor_id,
      change_type:   p.change_type,
      severity:      p.severity,
      trace_id:      event.trace_id,
    });
    await triggerEventPipeline(
      'competitor.change.detected',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

// ─── Demand spike → routing ───────────────────────────────────────────────────
const demandSpikeContract: HandlerContract<DemandSpikePayload> = {
  name:        'demand_spike→route',
  trigger:     'demand.spike.detected',
  description: 'Demand spikes trigger forecast + decide + dispatch via rule table.',
  chain:       'C',
  onError:     'log',
  condition:   (event) => event.payload.spike_factor >= 1.3,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Demand spike → routing', {
      business_id:  p.business_id,
      spike_factor: p.spike_factor,
      cause:        p.cause,
      trace_id:     event.trace_id,
    });
    await triggerEventPipeline(
      'demand.spike.detected',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

// ─── Churn risk → routing ─────────────────────────────────────────────────────
const churnRiskContract: HandlerContract<ChurnRiskDetectedPayload> = {
  name:        'churn_risk→route',
  trigger:     'churn.risk.detected',
  description: 'High churn risk activates retention-focused pipeline stages via rule table.',
  chain:       'multi',
  onError:     'log',
  condition:   (event) => event.payload.risk_level === 'high' || event.payload.risk_score >= 0.6,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Churn risk → routing', {
      business_id: p.business_id,
      risk_level:  p.risk_level,
      risk_score:  p.risk_score,
      trace_id:    event.trace_id,
    });
    await triggerEventPipeline(
      'churn.risk.detected',
      event.entity_id,
      p as unknown as Record<string, unknown>,
      event.trace_id,
    );
  },
};

// ─── Outcome recorded → weight update ─────────────────────────────────────────

const outcomeRecordedContract: HandlerContract<OutcomeRecordedPayload> = {
  name:        'outcome_recorded→weight_update',
  trigger:     'outcome.recorded',
  description: 'Recorded outcomes drive policy weight updates in the learning cycle.',
  chain:       'D',
  onError:     'log',
  condition:   (event) => event.payload.outcome_score !== null,
  handler: async (event) => {
    logger.info('Chain D: outcome recorded → weight update', {
      outcome_id:   event.payload.outcome_event_id,
      outcome_type: event.payload.outcome_type,
      score:        event.payload.outcome_score,
      trace_id:     event.trace_id,
    });
    // PolicyWeightUpdater.updateWeightFromOutcome() processes this
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

let initialized = false;

/**
 * Register all handler contracts against the EventBus.
 * Call once at server startup (idempotent — guards against double-init).
 */
export function registerAllHandlers(): void {
  if (initialized) return;
  initialized = true;

  // Chain A
  register(chainA_signalToOpportunity);
  register(chainA_opportunityDetected);

  // Chain B
  register(chainB_eventToOpportunity);

  // Chain C
  register(chainC_forecastToDecision);
  register(chainC_insightFused);
  register(chainC_decisionCreated);
  register(chainC_recommendationGenerated);

  // Chain D
  register(chainD_executionCompleted);
  register(chainD_feedbackReceived);
  register(chainD_memoryUpdated);
  register(outcomeRecordedContract);

  // Cross-chain
  register(approvalRequiredContract);
  register(threatDetectedContract);

  // Event-driven routing contracts (new — activate real pipeline stages)
  register(competitorChangeContract);
  register(demandSpikeContract);
  register(churnRiskContract);

  logger.info(`EventChoreographer: ${registeredContracts.length} contracts registered`);
}

/** Return all registered contracts (for testing and introspection). */
export function getRegisteredContracts(): HandlerContract[] {
  return [...registeredContracts];
}
