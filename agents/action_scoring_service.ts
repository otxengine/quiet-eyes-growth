// OTXEngine — Agent 9: ActionScoringService v2
// Trigger: bus event (arbitrage_action_ready, signal_qualified, trend_spike, competitor_change)
//          + scheduled fallback every hour
// Output: actions_recommended → publishes 'action_scored' to bus
// Formula: 9-factor ActionScore v2 (weights sum exactly 1.00)
// NEVER throws — all scoring wrapped in try/catch with neutral priors (0.5)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import { consumeFromBus } from "./orchestration/bus_consumer.ts";
import type {
  EnrichedContext,
  GlobalMemoryAggregate,
  HyperLocalEvent,
  DemandForecast,
  SyntheticPersona,
  CrossSectorSignal,
  CompetitorChange,
  ClassifiedSignal,
  BusEventHandler,
} from "./orchestration/types.ts";

const AGENT_NAME = "ActionScoringService";
const ACTION_THRESHOLD = parseFloat(Deno.env.get("ACTION_THRESHOLD") ?? "0.60");
const MAX_CONCURRENT = 3;

// ─── Interfaces ───────────────────────────────────────────────────────────────

type ActionType = "promote" | "respond" | "alert" | "hold";

interface ActionRow {
  business_id:        string;
  action_score:       number;
  action_type:        ActionType;
  expires_at:         string;
  source_ids:         string[];
  stale_memory_flag:  boolean;
  source_url:         string;
  confidence_score:   number;
  created_at:         string;
}

// ─── ActionScore v2 — 9 factors, weights sum = 1.00 ──────────────────────────
// Verified: 0.30+0.20+0.15+0.08+0.08+0.08+0.05+0.04+0.02 = 1.00

interface ScoringInputsV2 {
  businessFit:            number; // 0.30
  sectorSuccessRate:      number; // 0.20
  geoPerformance:         number; // 0.15
  priceTierPerf:          number; // 0.08
  recencyFactor:          number; // 0.08
  localEventBoost:        number; // 0.08 — from HyperLocalContextAgent
  personaConversionBoost: number; // 0.05 — from SyntheticPersonaSimulator
  crossSectorBoost:       number; // 0.04 — from CrossSectorBridgeAgent
  demandGapAdjustment:    number; // 0.02 — demand gap penalizes score
}

function computeActionScoreV2(inputs: ScoringInputsV2): number {
  const score =
    0.30 * inputs.businessFit +
    0.20 * inputs.sectorSuccessRate +
    0.15 * inputs.geoPerformance +
    0.08 * inputs.priceTierPerf +
    0.08 * inputs.recencyFactor +
    0.08 * inputs.localEventBoost +
    0.05 * inputs.personaConversionBoost +
    0.04 * inputs.crossSectorBoost +
    0.02 * inputs.demandGapAdjustment;

  // Unit assertion — weights must sum to exactly 1.00
  const WEIGHT_SUM = 0.30 + 0.20 + 0.15 + 0.08 + 0.08 + 0.08 + 0.05 + 0.04 + 0.02;
  if (Math.abs(WEIGHT_SUM - 1.00) > 1e-9) {
    throw new Error(`ActionScore weights do not sum to 1.00 (got ${WEIGHT_SUM})`);
  }

  return Math.min(1, Math.max(0, score));
}

// ─── Factor helpers ───────────────────────────────────────────────────────────

function getMemoryWeight(
  memory: GlobalMemoryAggregate[],
  aggType: string,
  dimensionKey: string,
  actionType: string = "promote",
): { value: number; stale: boolean } {
  const match = memory.find(
    (m) => m.agg_type === aggType && m.dimension_key === dimensionKey && m.action_type === actionType,
  );
  if (!match) return { value: 0.5, stale: true };
  return { value: match.success_rate ?? 0.5, stale: false };
}

function computeRecencyFactor(detectedAtUtc: string): number {
  const hours = (Date.now() - new Date(detectedAtUtc).getTime()) / (1000 * 60 * 60);
  return Math.exp(-0.05 * Math.max(0, hours));
}

function computeLocalEventBoost(events: HyperLocalEvent[]): number {
  if (events.length === 0) return 0.5;
  const maxAttendance = Math.max(...events.map((e) => e.expected_attendance ?? 0));
  const proximityBoost = Math.max(...events.map((e) => Math.max(0, 1 - e.distance_meters / 2000)));
  const attendanceBoost = Math.min(1, maxAttendance / 3000);
  return Math.min(1, 0.5 + 0.3 * attendanceBoost + 0.2 * proximityBoost);
}

function computeDemandGapAdjustment(forecasts: DemandForecast[]): number {
  if (forecasts.length === 0) return 1.0;
  const avgDelta = forecasts.reduce((s, f) => s + f.demand_delta_pct, 0) / forecasts.length;
  if (avgDelta <= -30) return 0.2;
  if (avgDelta <= -20) return 0.4;
  if (avgDelta <= -15) return 0.6;
  if (avgDelta <= 0)   return 0.8;
  return 1.0;
}

function getPersonaConversionBoost(personas: SyntheticPersona[]): number {
  if (personas.length === 0) return 0.5;
  const avg = personas.reduce((s, p) => s + p.simulated_conversion_rate, 0) / personas.length;
  return Math.min(1, avg * 2.5);
}

function getCrossSectorBoost(crossSignals: CrossSectorSignal[], sector: string): number {
  const relevant = crossSignals.filter((x) => x.target_sector === sector);
  if (relevant.length === 0) return 0.5;
  const maxCorr = Math.max(...relevant.map((x) => x.correlation_score));
  return Math.min(1, 0.5 + maxCorr * 0.5);
}

function computeBusinessFit(signals: ClassifiedSignal[]): number {
  if (signals.length === 0) return 0.5;
  const avgIntent = signals.reduce((a, s) => a + s.intent_score, 0) / signals.length;
  const avgSector = signals.reduce((a, s) => a + s.sector_match_score, 0) / signals.length;
  const avgGeo    = signals.reduce((a, s) => a + s.geo_match_score, 0) / signals.length;
  return Math.min(1, 0.5 * avgIntent + 0.3 * avgSector + 0.2 * avgGeo);
}

function determineActionType(
  hasQualifiedSignals: boolean,
  hasSpike: boolean,
  hasCompetitorChange: boolean,
  hasEventOpportunity: boolean,
): ActionType {
  if (hasCompetitorChange) return "alert";
  if (hasQualifiedSignals && hasSpike) return "promote";
  if (hasQualifiedSignals) return "respond";
  if (hasEventOpportunity) return "promote";
  return "hold";
}

function collectSourceIds(context: EnrichedContext): string[] {
  return [
    ...context.activeSignals.map((s) => s.id),
    ...context.activeTrends.map((t) => t.id),
    ...context.upcomingEvents.map((e) => e.id),
    ...context.competitorChanges.map((c) => c.id),
    ...context.crossSectorSignals.map((x) => x.id),
    ...context.personas.map((p) => p.id),
  ].filter(Boolean);
}

// ─── runActionScoringService — exported for BusListener dispatch ──────────────

export async function runActionScoringService(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  const {
    business, memoryWeights, activeSignals, activeTrends, upcomingEvents,
    demandForecast, personas, crossSectorSignals, competitorChanges,
  } = context;

  const NEUTRAL: ScoringInputsV2 = {
    businessFit:            0.5,
    sectorSuccessRate:      0.5,
    geoPerformance:         0.5,
    priceTierPerf:          0.5,
    recencyFactor:          0.5,
    localEventBoost:        0.5,
    personaConversionBoost: 0.5,
    crossSectorBoost:       0.5,
    demandGapAdjustment:    1.0,
  };

  let inputs = NEUTRAL;
  let staleMemoryFlag = true;

  try {
    const actionType = determineActionType(
      activeSignals.length > 0,
      activeTrends.length > 0,
      competitorChanges.length > 0,
      upcomingEvents.length > 0,
    );

    const sectorMem = getMemoryWeight(memoryWeights, "sector",     business.sector,               actionType);
    const geoMem    = getMemoryWeight(memoryWeights, "geo",        business.geo_city,             actionType);
    const tierMem   = getMemoryWeight(memoryWeights, "price_tier", business.price_tier ?? "mid",  actionType);

    const latestChange = (competitorChanges as CompetitorChange[])[0]?.detected_at_utc
      ?? activeSignals[0]?.processed_at;

    inputs = {
      businessFit:            computeBusinessFit(activeSignals),
      sectorSuccessRate:      sectorMem.value,
      geoPerformance:         geoMem.value,
      priceTierPerf:          tierMem.value,
      recencyFactor:          latestChange ? computeRecencyFactor(latestChange) : 0.5,
      localEventBoost:        computeLocalEventBoost(upcomingEvents),
      personaConversionBoost: getPersonaConversionBoost(personas),
      crossSectorBoost:       getCrossSectorBoost(crossSectorSignals, business.sector),
      demandGapAdjustment:    computeDemandGapAdjustment(demandForecast),
    };

    staleMemoryFlag = sectorMem.stale || geoMem.stale || tierMem.stale;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${AGENT_NAME}] Factor computation failed for ${business.id}, using neutral priors:`, msg);
    inputs = NEUTRAL;
  }

  const actionScore = computeActionScoreV2(inputs);
  const actionType  = determineActionType(
    activeSignals.length > 0,
    activeTrends.length > 0,
    competitorChanges.length > 0,
    upcomingEvents.length > 0,
  );

  if (actionScore < ACTION_THRESHOLD) {
    console.log(
      `[${AGENT_NAME}] ${business.id}: score ${actionScore.toFixed(3)} < threshold ${ACTION_THRESHOLD} — skip`,
    );
    return;
  }

  const sourceIds  = collectSourceIds(context);
  const allConf    = activeSignals.map((s) => s.confidence_score);
  const confidence = allConf.length > 0
    ? allConf.reduce((a, b) => a + b, 0) / allConf.length
    : 0.5;

  const sourceUrl =
    activeSignals[0]?.source_url ??
    activeTrends[0]?.source_url ??
    upcomingEvents[0]?.source_url ??
    (competitorChanges as CompetitorChange[])[0]?.source_url ??
    `https://otx.ai/signals?business_id=${business.id}`;

  const now       = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const actionRow: ActionRow = {
    business_id:       business.id,
    action_score:      Math.round(actionScore * 1000) / 1000,
    action_type:       actionType,
    expires_at:        expiresAt,
    source_ids:        sourceIds,
    stale_memory_flag: staleMemoryFlag,
    source_url:        sourceUrl,
    confidence_score:  Math.round(confidence * 100) / 100,
    created_at:        now,
  };

  const { data: inserted, error } = await supabase
    .from("actions_recommended")
    .insert(actionRow)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[${AGENT_NAME}] Insert failed for ${business.id}:`, error.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, error.message);
    return;
  }

  console.log(
    `[${AGENT_NAME}] ✓ ${business.id}: score=${actionScore.toFixed(3)}, ` +
    `type=${actionType}, sources=${sourceIds.length}, stale=${staleMemoryFlag}`,
  );

  // Publish to bus — triggers MarketMemoryEngine if score > 0.60
  if (inserted?.id) {
    await publishToBus(supabase, {
      business_id:    business.id,
      sourceAgent:    AGENT_NAME,
      sourceRecordId: inserted.id as string,
      sourceTable:    "actions_recommended",
      event_type:     "action_scored",
      payload: {
        action_score: actionScore,
        action_type:  actionType,
      },
    });
  }
}

// ─── Scheduled fallback: run for all businesses ───────────────────────────────

async function runScheduled(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting scheduled run at ${new Date().toISOString()}`);

  // Drain bus queue first
  const handlers: Record<string, BusEventHandler> = {
    signal_qualified:         async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    trend_spike:              async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    competitor_change:        async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    arbitrage_action_ready:   async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    local_event_detected:     async (p, bizId, evId) => {
      if (Number(p.attendance ?? 0) < 500) return;
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    demand_gap_forecast:      async (p, bizId, evId) => {
      if (Number(p.demand_delta ?? 0) >= -20) return;
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    persona_updated:          async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    cross_sector_opportunity: async (p, bizId, evId) => {
      if (Number(p.correlation_score ?? 0) < 0.65) return;
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
    memory_updated:           async (_p, bizId, evId) => {
      const ctx = await buildEnrichedContext(supabase, bizId, evId);
      if (ctx) await runActionScoringService(supabase, ctx);
    },
  };

  const { processed, errors: busErrors } = await consumeFromBus(supabase, AGENT_NAME, handlers);
  console.log(`[${AGENT_NAME}] Bus consumed: ${processed} events, ${busErrors} errors`);

  // Full-scan: score all businesses
  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  const queue = [...(businesses ?? []) as { id: string }[]];
  let successCount = 0;
  let errorCount = 0;

  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_CONCURRENT);
    await Promise.all(batch.map(async (biz) => {
      try {
        const context = await buildEnrichedContext(supabase, biz.id, "scheduled");
        if (!context) return;
        await runActionScoringService(supabase, context);
        successCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${AGENT_NAME}] Scheduled score failed for ${biz.id}:`, msg);
        errorCount++;
      }
    }));
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} scoring failures` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Scored: ${successCount}, Errors: ${errorCount}. Ping: ${now}`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

await runScheduled();
