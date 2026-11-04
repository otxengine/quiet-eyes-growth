/**
 * MarketIntelligenceService — Intelligence Layer Facade
 *
 * Coordinates all intelligence engines and produces a unified set of Insights,
 * a TrustState, and a ChurnRiskState from the EnrichedContext.
 *
 * Engines orchestrated (in order of signal fidelity):
 *   1. SupplyDemandMismatchDetector — demand > supply gaps
 *   2. WhiteSpaceRadar              — unserved market niches
 *   3. GhostDemandCartographer      — latent/seasonal demand
 *   4. PriceVacuumDetector          — pricing gaps vs competitors
 *   5. WorkforcePatternOpportunity  — B2B + workforce-driven demand
 *   6. TimingArbitrageEngine        — time-window demand gaps
 *   7. TrustSignalAggregator        — trust position + gap insights
 *   8. InvisibleChurnPredictor      — churn risk from external signals
 *
 * Rules:
 * - All engines run in parallel (Promise.allSettled)
 * - Insights are deduplicated by dedup_key
 * - Sorted by urgency weight × confidence
 * - Emits: insight.generated, market.intelligence.complete, trust.analyzed, churn.risk.detected
 * - No DB writes from this service — caller (MasterOrchestrator) persists results
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight, TrustState, ChurnRiskState } from '../../models';
import { bus }                          from '../../events/EventBus';
import { createLogger }                 from '../../infra/logger';
import { detectSupplyDemandMismatches } from './engines/SupplyDemandMismatchDetector';
import { detectWhiteSpaces }            from './engines/WhiteSpaceRadar';
import { detectGhostDemand }            from './engines/GhostDemandCartographer';
import { detectPriceVacuums }           from './engines/PriceVacuumDetector';
import { detectWorkforcePatterns }      from './engines/WorkforcePatternOpportunity';
import { detectTimingArbitrage }        from './engines/TimingArbitrageEngine';
import { analyzeTrustSignals }          from './engines/TrustSignalAggregator';
import { predictInvisibleChurn }        from './engines/InvisibleChurnPredictor';

const logger = createLogger('MarketIntelligenceService');

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MarketIntelligenceResult {
  insights:         Insight[];
  trust_state:      TrustState;
  churn_risk_state: ChurnRiskState;
  engines_run:      string[];
  duration_ms:      number;
}

// ─── Urgency weight for sorting ────────────────────────────────────────────────

const URGENCY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high:     0.75,
  medium:   0.50,
  low:      0.25,
};

function insightPriority(i: Insight): number {
  return (URGENCY_WEIGHT[i.urgency] ?? 0.5) * i.confidence * i.business_fit;
}

// ─── Main service ──────────────────────────────────────────────────────────────

export async function runMarketIntelligence(
  ctx:     EnrichedContext,
  traceId: string,
): Promise<MarketIntelligenceResult> {
  const t0 = Date.now();
  logger.info('MarketIntelligence started', { businessId: ctx.business_id });

  // Run all engines in parallel — allSettled so one failure doesn't abort all
  const [
    sddResult,
    wsResult,
    gdResult,
    pvResult,
    wpResult,
    taResult,
    trustResult,
    churnResult,
  ] = await Promise.allSettled([
    Promise.resolve(detectSupplyDemandMismatches(ctx)),
    Promise.resolve(detectWhiteSpaces(ctx)),
    Promise.resolve(detectGhostDemand(ctx)),
    Promise.resolve(detectPriceVacuums(ctx)),
    Promise.resolve(detectWorkforcePatterns(ctx)),
    Promise.resolve(detectTimingArbitrage(ctx)),
    Promise.resolve(analyzeTrustSignals(ctx)),
    Promise.resolve(predictInvisibleChurn(ctx)),
  ]);

  // Collect results, logging any engine failures
  const allInsights: Insight[] = [];
  const enginesRun: string[]   = [];

  function collect(result: PromiseSettledResult<Insight[]>, engine: string): void {
    if (result.status === 'fulfilled') {
      allInsights.push(...result.value);
      enginesRun.push(engine);
    } else {
      logger.error(`Engine ${engine} failed`, { error: result.reason?.message });
    }
  }

  collect(sddResult,  'SupplyDemandMismatchDetector');
  collect(wsResult,   'WhiteSpaceRadar');
  collect(gdResult,   'GhostDemandCartographer');
  collect(pvResult,   'PriceVacuumDetector');
  collect(wpResult,   'WorkforcePatternOpportunity');
  collect(taResult,   'TimingArbitrageEngine');

  // Trust + Churn return structured objects, extract insights
  let trust_state: TrustState = buildDefaultTrustState();
  let churn_risk_state: ChurnRiskState = buildDefaultChurnState();

  if (trustResult.status === 'fulfilled') {
    trust_state = trustResult.value.trust_state;
    allInsights.push(...trustResult.value.insights);
    enginesRun.push('TrustSignalAggregator');
  } else {
    logger.error('TrustSignalAggregator failed', { error: trustResult.reason?.message });
  }

  if (churnResult.status === 'fulfilled') {
    churn_risk_state = churnResult.value.churn_risk_state;
    allInsights.push(...churnResult.value.insights);
    enginesRun.push('InvisibleChurnPredictor');
  } else {
    logger.error('InvisibleChurnPredictor failed', { error: churnResult.reason?.message });
  }

  // ── Deduplicate by dedup_key (first-wins) ──────────────────────────────────
  const seen  = new Set<string>();
  const deduped: Insight[] = [];
  for (const ins of allInsights) {
    if (!seen.has(ins.dedup_key)) {
      seen.add(ins.dedup_key);
      deduped.push(ins);
    }
  }

  // ── Sort by priority (urgency × confidence × business_fit) ────────────────
  const sorted = deduped.sort((a, b) => insightPriority(b) - insightPriority(a));

  const duration_ms = Date.now() - t0;

  // ── Emit events ────────────────────────────────────────────────────────────

  // Emit insight.generated for each insight
  for (const insight of sorted) {
    await bus.emit(bus.makeEvent('insight.generated', ctx.business_id, {
      event_id:    `evt_${nanoid(8)}`,
      insight_id:  insight.id,
      business_id: ctx.business_id,
      engine:      insight.engine,
      type:        insight.type,
      category:    insight.category,
      urgency:     insight.urgency,
      confidence:  insight.confidence,
      dedup_key:   insight.dedup_key,
    }, traceId));
  }

  // Emit trust.analyzed
  await bus.emit(bus.makeEvent('trust.analyzed', ctx.business_id, {
    event_id:       `evt_${nanoid(8)}`,
    business_id:    ctx.business_id,
    trust_score:    trust_state.trust_score,
    gap_type:       trust_state.gap_type,
    vs_competitors: trust_state.vs_competitors,
  }, traceId));

  // Emit churn.risk.detected if non-trivial
  if (churn_risk_state.risk_level !== 'low') {
    await bus.emit(bus.makeEvent('churn.risk.detected', ctx.business_id, {
      event_id:     `evt_${nanoid(8)}`,
      business_id:  ctx.business_id,
      risk_level:   churn_risk_state.risk_level,
      risk_score:   churn_risk_state.risk_score,
      top_factor:   churn_risk_state.top_risk_factor,
    }, traceId));
  }

  const topUrgency = sorted[0]?.urgency ?? 'low';

  // Emit market.intelligence.complete
  await bus.emit(bus.makeEvent('market.intelligence.complete', ctx.business_id, {
    event_id:        `evt_${nanoid(8)}`,
    business_id:     ctx.business_id,
    insights_count:  sorted.length,
    engines_run:     enginesRun,
    top_urgency:     topUrgency,
    duration_ms,
    has_trust_gap:   trust_state.gap_type === 'lagging',
    has_churn_risk:  churn_risk_state.risk_level !== 'low',
  }, traceId));

  logger.info('MarketIntelligence complete', {
    businessId:     ctx.business_id,
    insightsFound:  sorted.length,
    enginesRun:     enginesRun.length,
    topUrgency,
    trustScore:     trust_state.trust_score,
    churnRisk:      churn_risk_state.risk_level,
    duration_ms,
  });

  return {
    insights:         sorted,
    trust_state,
    churn_risk_state,
    engines_run:      enginesRun,
    duration_ms,
  };
}

// ─── Defaults for failed engines ───────────────────────────────────────────────

function buildDefaultTrustState(): TrustState {
  return {
    trust_score:     50,
    vs_competitors:  0,
    review_velocity: 0,
    response_rate:   0.5,
    signal_strength: 'weak',
    gap_type:        'on_par',
    recommendations: [],
  };
}

function buildDefaultChurnState(): ChurnRiskState {
  return {
    risk_level:          'low',
    risk_score:          0,
    indicators:          [],
    estimated_churn_pct: 0,
    top_risk_factor:     'לא זוהו גורמי סיכון',
    window_days:         30,
  };
}

// ─── Filter helpers (for InsightFusion and DecisionEngine) ────────────────────

/** Top insights by category — for InsightFusion context enrichment */
export function getTopInsightsByCategory(
  insights: Insight[],
  category: Insight['category'],
  limit = 3,
): Insight[] {
  return insights
    .filter(i => i.category === category)
    .sort((a, b) => insightPriority(b) - insightPriority(a))
    .slice(0, limit);
}

/** High-urgency insights (critical or high) — for immediate action */
export function getUrgentInsights(insights: Insight[]): Insight[] {
  return insights.filter(
    i => i.urgency === 'critical' || i.urgency === 'high',
  );
}

/** Map Insight recommended_action_types to unique set */
export function extractActionTypes(insights: Insight[]): string[] {
  return [...new Set(insights.flatMap(i => i.recommended_action_types))];
}
