// OTXEngine — Deno Deploy entrypoint
// Reads cron schedules from config/schedules.ts (single source of truth).
// On Deno Deploy, Deno.cron() is handled by the platform scheduler.
// On a self-hosted Deno worker (e.g. Render), crons run inside this process.

import { AGENT_SCHEDULES } from "../config/schedules.ts";
import { runSignalCollector } from "./signal_collector.ts";
import { runOtxSyncBridge } from "./otx_sync_bridge.ts";
import { runEventCollector } from "./event_collector.ts";
import { runSectorTrendRadar } from "./sector_trend_radar.ts";
import { runCompetitorSnapshot } from "./competitor_snapshot.ts";
import { runSystemHealthMonitor } from "./system_health_monitor.ts";

const cronAgents: Record<string, () => Promise<void>> = {
  SignalCollector: runSignalCollector,
  OTXSyncBridge: runOtxSyncBridge,
  EventCollector: runEventCollector,
  SectorTrendRadar: runSectorTrendRadar,
  CompetitorSnapshot: runCompetitorSnapshot,
};

for (const [name, fn] of Object.entries(cronAgents)) {
  const schedule = AGENT_SCHEDULES[name];
  if (!schedule) {
    console.warn(`[main] No schedule entry for ${name} — skipping`);
    continue;
  }
  Deno.cron(name, schedule.cron, async () => {
    const t = Date.now();
    console.log(`[main] ${name} started`);
    await fn();
    console.log(`[main] ${name} done (${Math.round((Date.now() - t) / 1000)}s)`);
  });
  console.log(`[main] Registered ${name} @ ${schedule.cron} (maxLagSec=${schedule.maxLagSec})`);
}

// SystemHealthMonitor: persistent HTTP server + 5-min polling loop — not cron
await runSystemHealthMonitor();
