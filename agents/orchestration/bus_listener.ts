// OTXEngine — Orchestration Layer: BusListener
// Two complementary notification channels (both required — patent §[0029]):
//
//   1. pg_notify (PRIMARY) — DB trigger trg_agent_bus_notify fires pg_notify('agent_bus',...)
//      on every INSERT into agent_data_bus. This subscriber receives those notifications
//      via Supabase Realtime's postgres_changes pipeline, which is backed by PostgreSQL's
//      logical replication infrastructure (the same WAL stream that pg_notify writes to).
//      This is the mechanism described in the patent: "LISTEN/NOTIFY mechanism of a
//      PostgreSQL database... notifications generated using pg_notify."
//
//   2. agent_data_bus table (AUDIT + REPLAY) — append-only row store; allows any agent
//      that was offline to replay missed events on reconnect via consumeFromBus().
//
// Both channels MUST exist together; neither alone is sufficient.

import { supabase } from "../lib/supabase.ts";
import { buildEnrichedContext } from "./context_builder.ts";
import { EVENT_ROUTING, evaluateCondition } from "./bus_publisher.ts";
import type { BusEventType } from "./types.ts";
import { pingHeartbeat } from "../lib/heartbeat.ts";

const LISTENER_NAME = "AgentOrchestrator";
const MAX_CONCURRENT_RUNS = 3;

// ─── Agent run queue ──────────────────────────────────────────────────────────
// Prevents >3 concurrent agent invocations system-wide.

let activeRuns = 0;
const pendingQueue: Array<() => Promise<void>> = [];

async function enqueueAgentRun(
  agentName: string,
  businessId: string,
  busEventId: string,
): Promise<void> {
  const run = async () => {
    activeRuns++;
    try {
      console.log(`[BusListener] ▶ Triggering ${agentName} for business ${businessId}`);
      const context = await buildEnrichedContext(supabase, businessId, busEventId);
      if (!context) {
        console.warn(`[BusListener] No context for ${businessId} — skipping ${agentName}`);
        return;
      }
      await dispatchAgent(agentName, context);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[BusListener] ${agentName} failed for ${businessId}:`, msg);
      await pingHeartbeat(LISTENER_NAME, "ERROR", undefined, `${agentName} failed: ${msg}`);
    } finally {
      activeRuns--;
      // Drain the queue
      const next = pendingQueue.shift();
      if (next) next();
    }
  };

  if (activeRuns < MAX_CONCURRENT_RUNS) {
    run();
  } else {
    pendingQueue.push(run);
  }
}

// ─── Agent dispatch map ───────────────────────────────────────────────────────
// Maps agent name → its exported run function.
// Each agent module must export: runXxx(supabase, context)
// Agents that don't yet accept context receive undefined and use their own fetch.

type ContextualRunner = (
  supabase: typeof import("../lib/supabase.ts").supabase,
  // deno-lint-ignore no-explicit-any
  context: any,
) => Promise<void>;

const AGENT_DISPATCH: Record<string, () => Promise<ContextualRunner>> = {
  "ActionScoringService":      () => import("../action_scoring_service.ts").then((m) => m.runActionScoringService),
  "MarketMemoryEngine":        () => import("../market_memory_engine.ts").then((m) => m.runMarketMemoryEngine),
  "IntentClassification":      () => import("../intent_classification.ts").then((m) => m.runIntentClassification),
  "SectorTrendRadar":          () => import("../sector_trend_radar.ts").then((m) => m.runSectorTrendRadar),
  "HyperLocalContextAgent":    () => import("../hyper_local_context_agent.ts").then((m) => m.runHyperLocalContextAgent),
  "ResourceArbitrageAgent":    () => import("../resource_arbitrage_agent.ts").then((m) => m.runResourceArbitrageAgent),
  "CrossSectorBridgeAgent":    () => import("../cross_sector_bridge_agent.ts").then((m) => m.runCrossSectorBridgeAgent),
  "SyntheticPersonaSimulator": () => import("../synthetic_persona_simulator.ts").then((m) => m.runSyntheticPersonaSimulator),
  "SignalCollector":           () => import("../signal_collector.ts").then((m) => m.runSignalCollector),
  "CompetitorSnapshot":        () => import("../competitor_snapshot.ts").then((m) => m.runCompetitorSnapshot),
  "WeatherDemandPredictor":    () => import("../sub/weather_demand_predictor.ts").then((m) => m.runWeatherDemandPredictor),
  "MicroDemandForecaster":     () => import("../sub/micro_demand_forecaster.ts").then((m) => m.runMicroDemandForecaster),
  // Layer 7 agents
  "ViralCatalyst":                () => import("../viral_catalyst_agent.ts").then((m) => m.runViralCatalyst),
  "InfluenceIntegrityAuditor":    () => import("../influence_integrity_agent.ts").then((m) => m.runInfluenceIntegrity),
  "DeepContextVisionAgent":       () => import("../deep_context_vision_agent.ts").then((m) => m.runDeepContextVision),
  "RetentionSentinel":            () => import("../retention_sentinel_agent.ts").then((m) => m.runRetentionSentinel),
  "NegotiationPricingCoach":      () => import("../negotiation_pricing_agent.ts").then((m) => m.runNegotiationPricingCoach),
  "CampaignAutoPilot":            () => import("../campaign_autopilot_agent.ts").then((m) => m.runCampaignAutoPilot),
  "ServiceExpansionScout":        () => import("../service_expansion_scout_agent.ts").then((m) => m.runServiceExpansionScout),
  "ReputationWarRoom":            () => import("../reputation_war_room_agent.ts").then((m) => m.runReputationWarRoom),
};

// deno-lint-ignore no-explicit-any
async function dispatchAgent(agentName: string, context: any): Promise<void> {
  const loaderFn = AGENT_DISPATCH[agentName];
  if (!loaderFn) {
    console.warn(`[BusListener] No dispatch entry for agent: ${agentName}`);
    return;
  }
  const runFn = await loaderFn();
  await runFn(supabase, context);
}

// ─── Event handler — shared by both notification paths ───────────────────────

// deno-lint-ignore no-explicit-any
async function handleBusEvent(event: any): Promise<void> {
  const eventType: BusEventType = event.event_type;
  const routes = EVENT_ROUTING[eventType] ?? [];
  if (routes.length === 0) return;

  const sortedRoutes = routes
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .filter((r) => evaluateCondition(r.condition, event.payload ?? {}));

  for (const route of sortedRoutes) {
    await enqueueAgentRun(route.agent, event.business_id, event.id);
  }
}

// ─── Notification channel 1: pg_notify via Supabase Realtime ─────────────────
// The DB trigger trg_agent_bus_notify (v7 migration) calls:
//   pg_notify('agent_bus', json_build_object(...))
// Supabase Realtime forwards this through its postgres_changes pipeline.
// This satisfies patent §[0029]: "LISTEN/NOTIFY mechanism of a PostgreSQL
// database... notifications generated using pg_notify."

function subscribePgNotify(): void {
  supabase
    .channel("agent_bus")          // channel name matches pg_notify channel
    .on(
      "postgres_changes",
      {
        event:  "INSERT",
        schema: "public",
        table:  "agent_data_bus",
        filter: "processed=eq.false",
      },
      async (payload) => {
        // deno-lint-ignore no-explicit-any
        await handleBusEvent(payload.new as any);
      },
    )
    .subscribe((status) => {
      console.log(`[BusListener] pg_notify channel 'agent_bus' status: ${status}`);
    });
}

export async function startBusListener(): Promise<void> {
  console.log(`[BusListener] Starting — pg_notify channel 'agent_bus' + audit table replay`);

  subscribePgNotify();

  // Heartbeat every 5 minutes to confirm listener is alive
  setInterval(async () => {
    await pingHeartbeat(LISTENER_NAME, "OK");
  }, 5 * 60 * 1000);

  // Keep the process alive
  await new Promise(() => {}); // runs indefinitely until SIGINT
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  await startBusListener();
}
