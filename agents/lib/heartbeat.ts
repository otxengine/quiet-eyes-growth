// OTXEngine — Heartbeat utility used by all agents
import { supabase } from "./supabase.ts";

export type HeartbeatStatus = "OK" | "DELAYED" | "ERROR";

export async function pingHeartbeat(
  agentName: string,
  status: HeartbeatStatus,
  lastIngestionUtc?: string,
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabase.from("agent_heartbeat").insert({
    agent_name: agentName,
    last_ping_utc: new Date().toISOString(),
    last_ingestion_utc: lastIngestionUtc ?? null,
    status,
    error_message: errorMessage ?? null,
  });
  if (error) {
    console.error(`[heartbeat] Failed to ping for ${agentName}:`, error.message);
  }
}
