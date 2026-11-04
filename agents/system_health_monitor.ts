// OTXEngine — Agent: SystemHealthMonitor
// Schedule: every 5 minutes (CRITICAL priority)
// Exposes /health HTTP endpoint + writes heartbeat status

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "SystemHealthMonitor";
const DELAY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface HeartbeatRow {
  agent_name: string;
  last_ping_utc: string;
  last_ingestion_utc: string | null;
  status: "OK" | "DELAYED" | "ERROR";
  error_message: string | null;
}

interface AgentHealthStatus {
  name: string;
  status: "OK" | "DELAYED" | "DOWN" | "ERROR";
  last_ping: string | null;
  last_ingestion: string | null;
  error_message: string | null;
}

interface HealthResponse {
  agents: AgentHealthStatus[];
  overall: "OK" | "DEGRADED" | "DOWN";
  checked_at: string;
}

// ─── Known agents (all 9 + self) ─────────────────────────────────────────────

const EXPECTED_AGENTS = [
  "SignalCollector",
  "EventCollector",
  "CompetitorSnapshot",
  "IntentClassification",
  "SectorTrendRadar",
  "EventImpactEngine",
  "ProfileIntelligence",
  "MarketMemoryEngine",
  "ActionScoringService",
];

// ─── Check health of all agents ───────────────────────────────────────────────

async function checkAgentHealth(): Promise<HealthResponse> {
  const now = new Date();

  // Get latest heartbeat per agent
  const { data, error } = await supabase
    .from("agent_heartbeat")
    .select("agent_name, last_ping_utc, last_ingestion_utc, status, error_message")
    .order("last_ping_utc", { ascending: false });

  if (error) {
    return {
      agents: EXPECTED_AGENTS.map((name): AgentHealthStatus => ({
        name,
        status: "DOWN",
        last_ping: null,
        last_ingestion: null,
        error_message: "Cannot reach agent_heartbeat table",
      })),
      overall: "DOWN",
      checked_at: now.toISOString(),
    };
  }

  // Deduplicate — keep latest row per agent
  const latestByAgent = new Map<string, HeartbeatRow>();
  for (const row of (data ?? []) as HeartbeatRow[]) {
    if (!latestByAgent.has(row.agent_name)) {
      latestByAgent.set(row.agent_name, row);
    }
  }

  const agentStatuses: AgentHealthStatus[] = EXPECTED_AGENTS.map((name): AgentHealthStatus => {
    const row = latestByAgent.get(name);

    if (!row) {
      return {
        name,
        status: "DOWN",
        last_ping: null,
        last_ingestion: null,
        error_message: "No heartbeat received",
      };
    }

    const lastPing = new Date(row.last_ping_utc).getTime();
    const msSinceLastPing = now.getTime() - lastPing;

    let status: AgentHealthStatus["status"] = row.status;
    if (msSinceLastPing > DELAY_THRESHOLD_MS && status === "OK") {
      status = "DELAYED";
    }

    return {
      name,
      status,
      last_ping: row.last_ping_utc,
      last_ingestion: row.last_ingestion_utc,
      error_message: row.error_message,
    };
  });

  // Overall: DOWN if any agent is DOWN; DEGRADED if any DELAYED/ERROR; OK otherwise
  const hasDown = agentStatuses.some((a) => a.status === "DOWN");
  const hasDegraded = agentStatuses.some((a) => a.status === "DELAYED" || a.status === "ERROR");
  const overall: HealthResponse["overall"] = hasDown ? "DOWN" : hasDegraded ? "DEGRADED" : "OK";

  return {
    agents: agentStatuses,
    overall,
    checked_at: now.toISOString(),
  };
}

// ─── HTTP /health endpoint ────────────────────────────────────────────────────

async function serveHealth(port: number): Promise<void> {
  const healthData = await checkAgentHealth();

  // Log any degraded agents
  for (const agent of healthData.agents) {
    if (agent.status !== "OK") {
      console.warn(`[${AGENT_NAME}] ${agent.name}: ${agent.status} — ${agent.error_message ?? "no error"}`);
    }
  }

  await pingHeartbeat(
    AGENT_NAME,
    healthData.overall === "OK" ? "OK" : healthData.overall === "DOWN" ? "ERROR" : "DELAYED",
    new Date().toISOString(),
    healthData.overall !== "OK" ? `Overall: ${healthData.overall}` : undefined,
  );

  // Serve HTTP
  Deno.serve({ port }, (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify(healthData, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store",
        },
      });
    }
    return new Response("OTX SystemHealthMonitor", { status: 200 });
  });
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const port = parseInt(Deno.env.get("HEALTH_PORT") ?? "8080");
  console.log(`[${AGENT_NAME}] Starting on port ${port} at ${new Date().toISOString()}`);

  // Initial check + serve
  await serveHealth(port);

  // Poll every 5 minutes while server is running
  setInterval(async () => {
    const health = await checkAgentHealth();
    console.log(`[${AGENT_NAME}] Overall: ${health.overall} (${health.checked_at})`);

    for (const agent of health.agents) {
      if (agent.status !== "OK") {
        console.warn(`  ⚠ ${agent.name}: ${agent.status}`);
      }
    }

    await pingHeartbeat(
      AGENT_NAME,
      health.overall === "OK" ? "OK" : health.overall === "DOWN" ? "ERROR" : "DELAYED",
      new Date().toISOString(),
    );
  }, 5 * 60 * 1000);
}

if (import.meta.main) {
  await run();
}
