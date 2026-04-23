/**
 * MasterOrchestrator — the central control plane for OTXEngine.
 *
 * Manages the full pipeline:
 * 1. Ingest → 2. Classify → 3. Trends → 4. Predict
 * 5. Context → 6. Opportunities → 7. Fuse → 8. Decide → 9. Score
 * 10. Recommend → 11. Dispatch → 12. Learn
 *
 * RULES:
 * - Deduplicates runs per business (no concurrent full scans)
 * - Enforces pipeline stage ordering
 * - Logs every stage result
 * - Emits orchestration events at start/stage/end
 * - Handles stage failures gracefully (continue or abort)
 * - Idempotent: safe to re-run
 */

import { nanoid } from 'nanoid';
import {
  PipelineRun, StageResult, PipelineStage, PipelineSummary,
} from '../models';
import { buildEnrichedContext, EnrichedContext } from '../intelligence/ContextBuilder';
import { runMarketIntelligence } from '../services/intelligence/MarketIntelligenceService';
import { detectOpportunities } from '../services/intelligence/OpportunityDetector';
import { detectThreats }       from '../services/intelligence/ThreatDetector';
import { fuseInsight }         from '../services/intelligence/InsightFusion';
import { processSignals }      from '../services/intelligence/SignalProcessor';
import { computeForecasts }    from '../services/prediction/DemandForecastingService';
import { makeDecisions }       from '../services/decision/DecisionEngine';
import { generateRecommendations } from '../services/decision/RecommendationGenerator';
import { dispatchAll }         from '../services/execution/ActionDispatcher';
import { fullMemoryCycle }     from '../services/learning/BusinessMemoryEngine';
import { runPolicyUpdateCycle } from '../services/learning/PolicyWeightUpdater';
import { decisionRepository }  from '../repositories/DecisionRepository';
import { bus }                 from '../events/EventBus';
import { createLogger }        from '../infra/logger';
import { writeAutomationLog }  from '../lib/automationLog';
import { prisma }              from '../db';

const logger = createLogger('MasterOrchestrator');

// ─── Dedup guard (in-memory, per process) ────────────────────────────────────

const RUNNING = new Set<string>();   // businessId currently running
const RUN_COOLDOWN_MS = 5 * 60_000; // 5 minutes between full runs
const lastRun = new Map<string, number>();

// ─── Stage executor with timing ───────────────────────────────────────────────

async function runStage<T>(
  stageName: PipelineStage,
  fn: () => Promise<T>,
  traceId: string,
  businessId: string,
): Promise<{ result: T | null; stageResult: StageResult }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - t0;

    const stageResult: StageResult = {
      status:      'ok',
      duration_ms: duration,
      items:       countItems(result),
      error:       undefined,
    };

    await bus.emit(bus.makeEvent('orchestration.stage.completed', businessId, {
      run_id:      traceId,
      business_id: businessId,
      stage:       stageName,
      duration_ms: duration,
      items:       stageResult.items,
      status:      'ok',
    }, traceId));

    logger.info(`Stage ${stageName} ok`, { businessId, duration_ms: duration, items: stageResult.items });
    return { result, stageResult };
  } catch (err: any) {
    const duration = Date.now() - t0;
    logger.error(`Stage ${stageName} failed`, { businessId, error: err.message });
    return {
      result: null,
      stageResult: { status: 'error', duration_ms: duration, items: 0, error: err.message },
    };
  }
}

function countItems(result: unknown): number {
  if (result === null || result === undefined) return 0;
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'object' && result !== null) {
    const r = result as any;
    return r.length ?? r.count ?? r.total ?? r.signals_processed ??
           r.items_created ?? r.insights_created ?? 1;
  }
  return 0;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  mode:        'full' | 'partial' | 'signal_only' | 'decision_only';
  triggeredBy: 'schedule' | 'manual' | 'event' | 'webhook';
  skipStages?: PipelineStage[];
  forceRun?:  boolean;
}

export async function runPipeline(
  businessId: string,
  options: OrchestratorOptions = { mode: 'full', triggeredBy: 'manual' },
): Promise<PipelineRun> {
  const runId     = `run_${nanoid(10)}`;
  const traceId   = nanoid(21);
  const startedAt = new Date().toISOString();

  // ── Dedup check ──────────────────────────────────────────────────────────────
  if (!options.forceRun) {
    if (RUNNING.has(businessId)) {
      logger.warn('Pipeline already running, skipping', { businessId });
      return makeSkippedRun(runId, businessId, traceId, 'already_running', startedAt);
    }
    const last = lastRun.get(businessId) ?? 0;
    if (Date.now() - last < RUN_COOLDOWN_MS && options.mode === 'full') {
      const waitMin = Math.ceil((RUN_COOLDOWN_MS - (Date.now() - last)) / 60000);
      logger.info(`Cooldown active, skipping full run (${waitMin}m remaining)`, { businessId });
      return makeSkippedRun(runId, businessId, traceId, `cooldown:${waitMin}m`, startedAt);
    }
  }

  RUNNING.add(businessId);
  lastRun.set(businessId, Date.now());

  logger.info('Pipeline started', { runId, businessId, mode: options.mode });

  // Emit start
  await bus.emit(bus.makeEvent('orchestration.started', businessId, {
    run_id:       runId,
    business_id:  businessId,
    mode:         options.mode,
    triggered_by: options.triggeredBy,
  }, traceId));

  const stages: Partial<Record<PipelineStage, StageResult>> = {};
  const skip = new Set(options.skipStages ?? []);

  // Summary counters
  let signalsProcessed   = 0;
  let insightsCreated    = 0;
  let decisionsCreated   = 0;
  let actionsDispatched  = 0;
  let opportunitiesFound = 0;
  let threatsFound       = 0;

  // Pipeline-level state
  let context: EnrichedContext | null = null;
  let fusedInsight:    Awaited<ReturnType<typeof fuseInsight>> | null         = null;
  let decisions:       Awaited<ReturnType<typeof makeDecisions>>              = [];
  let recommendations: Awaited<ReturnType<typeof generateRecommendations>>    = [];

  try {
    // ── Stage: context ────────────────────────────────────────────────────────
    if (!skip.has('context') && options.mode !== 'signal_only') {
      const { result, stageResult } = await runStage(
        'context',
        () => buildEnrichedContext(businessId),
        traceId, businessId,
      );
      stages.context = stageResult;
      context = result;

      if (context) {
        signalsProcessed = context.signals.total;
        context.trace_id = traceId;
      }
    }

    // ── Stage: classify ────────────────────────────────────────────────────────
    // SignalProcessor: score & classify raw signals → inject into context.signals
    if (!skip.has('classify') && context && options.mode !== 'decision_only') {
      const { result: spResult, stageResult: spStage } = await runStage(
        'classify',
        () => processSignals(context!, traceId),
        traceId, businessId,
      );
      stages.classify = spStage;

      if (spResult) {
        signalsProcessed = spResult.total_raw;
        // context.signals already mutated in-place by processSignals
      }
    }

    // ── Stage: opportunities ──────────────────────────────────────────────────
    // Run OpportunityDetector + ThreatDetector, inject results into context
    if (!skip.has('opportunities') && context && options.mode !== 'signal_only') {
      const { result: oppResult, stageResult: oppStage } = await runStage(
        'opportunities',
        async () => {
          const [opps, threats] = await Promise.all([
            detectOpportunities(context!, traceId),
            detectThreats(context!, traceId),
          ]);
          return { opportunities: opps, threats };
        },
        traceId, businessId,
      );
      stages.opportunities = oppStage;

      if (oppResult) {
        context.active_opportunities = oppResult.opportunities;
        context.active_threats       = oppResult.threats;
        opportunitiesFound = oppResult.opportunities.length;
        threatsFound       = oppResult.threats.length;
      }
    }

    // ── Stage: market_intelligence ────────────────────────────────────────────
    // Run all 8 intelligence engines in parallel; inject results into context
    if (!skip.has('market_intelligence') && context && options.mode !== 'signal_only') {
      const { result: miResult, stageResult: miStage } = await runStage(
        'market_intelligence',
        () => runMarketIntelligence(context!, traceId),
        traceId, businessId,
      );
      stages.market_intelligence = miStage;

      if (miResult && context) {
        context.market_insights    = miResult.insights;
        context.trust_state        = miResult.trust_state;
        context.churn_risk_state   = miResult.churn_risk_state;
        // Count market insights as part of insights created
        insightsCreated += miResult.insights.length;
      }
    }

    // ── Stage: predict ─────────────────────────────────────────────────────────
    // DemandForecastingService: compute demand forecasts → inject into context.forecasts
    if (!skip.has('predict') && context && options.mode !== 'signal_only') {
      const { result: fcResult, stageResult: fcStage } = await runStage(
        'predict',
        () => computeForecasts(context!, traceId),
        traceId, businessId,
      );
      stages.predict = fcStage;
      // context.forecasts already mutated in-place by computeForecasts
    }

    // ── Stage: fuse ────────────────────────────────────────────────────────────
    if (!skip.has('fuse') && context && options.mode !== 'signal_only') {
      const { result, stageResult } = await runStage(
        'fuse',
        () => fuseInsight(context!),
        traceId, businessId,
      );
      stages.fuse = stageResult;
      fusedInsight = result;
      if (fusedInsight) insightsCreated = 1;
    }

    // ── Stage: decide ──────────────────────────────────────────────────────────
    if (!skip.has('decide') && context && fusedInsight &&
        options.mode !== 'signal_only') {
      const { result, stageResult } = await runStage(
        'decide',
        () => makeDecisions(context!, fusedInsight!),
        traceId, businessId,
      );
      stages.decide = stageResult;
      decisions = result ?? [];
      decisionsCreated = decisions.length;
    }

    // ── Stage: recommend ───────────────────────────────────────────────────────
    if (!skip.has('recommend') && context && decisions.length > 0) {
      const { result, stageResult } = await runStage(
        'recommend',
        () => generateRecommendations(decisions, context!),
        traceId, businessId,
      );
      stages.recommend = stageResult;
      recommendations = result ?? [];
    }

    // ── Stage: dispatch ────────────────────────────────────────────────────────
    if (!skip.has('dispatch') && decisions.length > 0 && recommendations.length > 0) {
      const { result, stageResult } = await runStage(
        'dispatch',
        () => dispatchAll(decisions, recommendations, traceId),
        traceId, businessId,
      );
      stages.dispatch = stageResult;
      actionsDispatched = result ?? 0;
    }

    // ── Stage: learn ───────────────────────────────────────────────────────────
    if (!skip.has('learn') && options.mode === 'full') {
      const { stageResult } = await runStage(
        'learn',
        async () => {
          const memResult    = await fullMemoryCycle(businessId, traceId);
          const policyResult = await runPolicyUpdateCycle(businessId, traceId);
          return { ...memResult, ...policyResult };
        },
        traceId, businessId,
      );
      stages.learn = stageResult;
    }

  } finally {
    RUNNING.delete(businessId);
  }

  const duration_ms = Date.now() - new Date(startedAt).getTime();

  const summary: PipelineSummary = {
    signals_processed:  signalsProcessed,
    insights_created:   insightsCreated,
    decisions_created:  decisionsCreated,
    actions_dispatched: actionsDispatched,
    opportunities_found: opportunitiesFound,
    threats_found:      threatsFound,
    duration_ms,
  };

  // Persist pipeline run
  await decisionRepository.savePipelineRun(runId, businessId, {
    trace_id:     traceId,
    mode:         options.mode,
    triggered_by: options.triggeredBy,
    status:       'completed',
    started_at:   startedAt,
    ...summary,
  });

  // Automation log (compatibility with existing UI)
  await writeAutomationLog('masterOrchestrator', businessId, startedAt, decisionsCreated);

  // Emit complete
  await bus.emit(bus.makeEvent('orchestration.completed', businessId, {
    run_id:              runId,
    business_id:         businessId,
    stages_run:          Object.keys(stages).length,
    duration_ms,
    decisions:           decisionsCreated,
    insights:            insightsCreated,
    actions:             actionsDispatched,
    opportunities_found: opportunitiesFound,
    threats_found:       threatsFound,
  }, traceId));

  logger.info('Pipeline completed', {
    runId, businessId,
    duration_ms, decisionsCreated, insightsCreated, actionsDispatched,
    opportunitiesFound, threatsFound,
  });

  return {
    run_id:       runId,
    business_id:  businessId,
    trace_id:     traceId,
    mode:         options.mode,
    triggered_by: options.triggeredBy,
    started_at:   startedAt,
    completed_at: new Date().toISOString(),
    status:       'completed',
    stages:       stages as Record<PipelineStage, StageResult>,
    summary,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSkippedRun(
  runId:      string,
  businessId: string,
  traceId:    string,
  reason:     string,
  startedAt:  string,
): PipelineRun {
  return {
    run_id:       runId,
    business_id:  businessId,
    trace_id:     traceId,
    mode:         'full',
    triggered_by: 'manual',
    started_at:   startedAt,
    completed_at: new Date().toISOString(),
    status:       'skipped',
    stages:       {} as Record<PipelineStage, StageResult>,
    summary: {
      signals_processed:   0,
      insights_created:    0,
      decisions_created:   0,
      actions_dispatched:  0,
      opportunities_found: 0,
      threats_found:       0,
      duration_ms:         0,
    },
  };
}

// ─── Convenience runners ──────────────────────────────────────────────────────

/** Quick context + decision run (no ingest, no dispatch, no learn) */
export async function runDecisionOnly(businessId: string): Promise<PipelineRun> {
  return runPipeline(businessId, {
    mode: 'decision_only',
    triggeredBy: 'manual',
    skipStages: ['dispatch', 'learn'],
  });
}

/** Full scan triggered by schedule */
export async function runScheduled(businessId: string): Promise<PipelineRun> {
  return runPipeline(businessId, {
    mode: 'full',
    triggeredBy: 'schedule',
  });
}

/** Status of current runs */
export function getRunningBusinesses(): string[] {
  return Array.from(RUNNING);
}
