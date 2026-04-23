// OTXEngine — Phase 8: Agent schedule declarations
// All cron expressions in UTC. Deno cron syntax.
// Event-driven agents (IntentClassification, EventImpactEngine, ActionScoringService)
// are triggered via pg_notify — they do NOT use cron entries.

export interface AgentScheduleConfig {
  cron: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  maxLagSec: number | null; // null = no SLA (nightly low-priority jobs)
  description: string;
  entrypoint: string;        // relative path to agent file
}

export const AGENT_SCHEDULES: Record<string, AgentScheduleConfig> = {
  SignalCollector: {
    cron: "*/30 * * * *",
    priority: "HIGH",
    maxLagSec: 120,
    description: "Ingests raw signals from SerpAPI, Reddit, Google Trends every 30 min",
    entrypoint: "agents/signal_collector.ts",
  },

  EventCollector: {
    cron: "0 * * * *",
    priority: "MEDIUM",
    maxLagSec: 300,
    description: "Fetches Israeli events and holidays every 60 min",
    entrypoint: "agents/event_collector.ts",
  },

  SectorTrendRadar: {
    cron: "0 * * * *",
    priority: "MEDIUM",
    maxLagSec: 300,
    description: "Computes Z-score spike detection per sector every 60 min",
    entrypoint: "agents/sector_trend_radar.ts",
  },

  CompetitorSnapshot: {
    cron: "0 */6 * * *",
    priority: "MEDIUM",
    maxLagSec: 900,
    description: "Diffs competitor website/reviews/social every 6 hours",
    entrypoint: "agents/competitor_snapshot.ts",
  },

  ProfileIntelligence: {
    cron: "0 3 * * *",
    priority: "LOW",
    maxLagSec: null,
    description: "Rebuilds business embeddings via OpenAI daily at 03:00 UTC",
    entrypoint: "agents/profile_intelligence.ts",
  },

  MarketMemoryEngine: {
    cron: "0 2 * * *",
    priority: "LOW",
    maxLagSec: null,
    description: "Aggregates 4-layer global memory (global/sector/geo/price_tier) nightly at 02:00 UTC",
    entrypoint: "agents/market_memory_engine.ts",
  },

  OTXSyncBridge: {
    cron: "*/10 * * * *",
    priority: "HIGH",
    maxLagSec: 60,
    description: "Syncs OTX intelligence (signals, trends, events, actions) into QuietEyes dashboard entities every 10 min",
    entrypoint: "agents/otx_sync_bridge.ts",
  },

  SystemHealthMonitor: {
    cron: "*/5 * * * *",
    priority: "CRITICAL",
    maxLagSec: null, // persistent HTTP process — always on
    description: "Monitors all agent heartbeats and serves /health endpoint every 5 min",
    entrypoint: "agents/system_health_monitor.ts",
  },
};

// Event-driven agents (triggered via pg_notify, not cron):
// - IntentClassification  → pg_notify on signals_raw insert + 5-min polling fallback
// - EventImpactEngine     → pg_notify on events_raw insert + nightly full recompute
// - ActionScoringService  → Priority Queue (max 3 concurrent, 2h TTL backlog)

export const EVENT_DRIVEN_AGENTS = {
  IntentClassification: {
    trigger: "pg_notify:signals_raw",
    fallbackCron: "*/5 * * * *",
    entrypoint: "agents/intent_classification.ts",
  },
  EventImpactEngine: {
    trigger: "pg_notify:events_raw",
    fallbackCron: "0 3 * * *",
    entrypoint: "agents/event_impact_engine.ts",
  },
  ActionScoringService: {
    trigger: "priority_queue",
    maxConcurrent: 3,
    backlogTtlMs: 2 * 60 * 60 * 1000,
    entrypoint: "agents/action_scoring_service.ts",
  },
} as const;
