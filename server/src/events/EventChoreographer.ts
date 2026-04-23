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
} from './contracts';
import { createLogger } from '../infra/logger';

const logger = createLogger('EventChoreographer');

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
  description: 'When a signal is classified with sufficient relevance, attempt opportunity detection.',
  chain:       'A',
  onError:     'log',
  condition:   (event) => {
    const p = event.payload;
    // Only forward signals with meaningful relevance + confidence
    return p.relevance_score >= 0.3 && p.confidence >= 0.3;
  },
  handler: async (event) => {
    // The OpportunityDetector is invoked by MasterOrchestrator in its
    // 'opportunities' stage — here we log the linkage for traceability.
    logger.debug('Chain A: signal classified → opportunity pipeline', {
      signal_id: event.payload.signal_id,
      trace_id:  event.trace_id,
      relevance: event.payload.relevance_score,
    });
    // Downstream: MasterOrchestrator polls signals then runs detectOpportunities()
    // This handler is the explicit contract that the linkage exists.
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
  description: 'Significant forecast updates should trigger context rebuild and re-fusion.',
  chain:       'C',
  onError:     'log',
  condition:   (event) => {
    // Only trigger when forecast has high confidence
    return event.payload.confidence >= 0.55 && event.payload.expected_demand_score >= 0.4;
  },
  handler: async (event) => {
    logger.info('Chain C: forecast update warrants pipeline re-run', {
      forecast_id: event.payload.forecast_id,
      business_id: event.payload.business_id,
      confidence:  event.payload.confidence,
      trace_id:    event.trace_id,
    });
    // MasterOrchestrator picks up on this via scheduled runs or explicit trigger
    // In production: enqueue a high-priority run for this business
  },
};

const chainC_insightFused: HandlerContract<InsightFusedPayload> = {
  name:        'insight_fused→decision_gate',
  trigger:     'insight.fused',
  description: 'Fused insight is the gate to decision creation; log urgency for monitoring.',
  chain:       'C',
  onError:     'log',
  condition:   (event) => event.payload.confidence >= 0.30,
  handler: async (event) => {
    const p = event.payload;
    logger.info('Chain C: insight fused → awaiting decision', {
      insight_id:   p.fused_insight_id,
      urgency:      p.urgency,
      primary_type: p.primary_type,
      confidence:   p.confidence,
      trace_id:     event.trace_id,
    });
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
  description: 'Completed executions always feed back into the learning cycle.',
  chain:       'D',
  onError:     'log',
  condition:   (_event) => true,
  handler: async (event) => {
    logger.info('Chain D: execution completed → learning cycle', {
      task_id:    event.payload.execution_task_id,
      status:     event.payload.result_status,
      trace_id:   event.trace_id,
    });
    // PolicyWeightUpdater.runPolicyUpdateCycle() is called by OutcomeTracker
    // after outcome is recorded.
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
  name:        'threat_detected→escalate_high_risk',
  trigger:     'threat.detected',
  description: 'High-risk threats (score >= 0.7) are escalated for immediate review.',
  chain:       'multi',
  onError:     'dead_letter',
  condition:   (event) => event.payload.risk_score >= 0.7 && event.payload.is_new,
  handler: async (event) => {
    logger.warn('HIGH-RISK THREAT DETECTED — escalating', {
      threat_id:  event.payload.threat_id,
      type:       event.payload.type,
      risk_score: event.payload.risk_score,
      urgency:    event.payload.urgency,
      trace_id:   event.trace_id,
    });
    // In production: trigger P0 pipeline run and notify on-call
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

  logger.info(`EventChoreographer: ${registeredContracts.length} contracts registered`);
}

/** Return all registered contracts (for testing and introspection). */
export function getRegisteredContracts(): HandlerContract[] {
  return [...registeredContracts];
}
