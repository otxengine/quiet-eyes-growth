// OTXEngine — Orchestration Layer: BusConsumer
// Each agent calls consumeFromBus() at startup to process queued events
// before running its own scheduled logic.
// Bus is append-only — we only update consumed_by[] and processed flag.

import type { SupabaseClient, BusRow, BusEventHandler } from "./types.ts";
import { pingHeartbeat } from "../lib/heartbeat.ts";

const MAX_EVENTS_PER_POLL = 50;

// ─── consumeFromBus ───────────────────────────────────────────────────────────
// Pulls unprocessed events targeting this agent, ordered by priority.
// Invokes the matching handler and marks the event consumed.
// NEVER throws — all handler errors are caught and reported via heartbeat.

export async function consumeFromBus(
  supabase: SupabaseClient,
  agentName: string,
  handlers: Record<string, BusEventHandler>,
): Promise<{ processed: number; errors: number }> {
  const now = new Date().toISOString();

  // Pull events: targeted at this agent, not yet consumed by it, not expired
  const { data: events, error } = await supabase
    .from("agent_data_bus")
    .select("*")
    .contains("target_agents", [agentName])
    .not("consumed_by", "cs", `{${agentName}}`)
    .eq("processed", false)
    .gt("expires_at", now)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_EVENTS_PER_POLL);

  if (error) {
    console.error(`[BusConsumer:${agentName}] Failed to pull from bus:`, error.message);
    await pingHeartbeat(agentName, "ERROR", undefined, `Bus pull failed: ${error.message}`);
    return { processed: 0, errors: 1 };
  }

  if (!events || events.length === 0) return { processed: 0, errors: 0 };

  console.log(`[BusConsumer:${agentName}] Found ${events.length} bus event(s) to process`);

  let processed = 0;
  let errors = 0;

  for (const rawEvent of events) {
    const event = rawEvent as BusRow;
    const handler = handlers[event.event_type];

    if (!handler) {
      // No handler registered for this event type — mark consumed to avoid reprocessing
      await markConsumed(supabase, event, agentName);
      continue;
    }

    try {
      await handler(event.payload, event.business_id, event.id);
      await markConsumed(supabase, event, agentName);
      processed++;
      console.log(`[BusConsumer:${agentName}] ✓ Handled ${event.event_type} from ${event.source_agent}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[BusConsumer:${agentName}] Handler failed for ${event.event_type}:`, msg);
      await pingHeartbeat(agentName, "ERROR", undefined, `Bus handler failed: ${msg}`);
      errors++;
      // Do NOT mark consumed on error — allow retry on next poll
    }
  }

  return { processed, errors };
}

// ─── Mark event consumed by this agent ───────────────────────────────────────
// Adds agentName to consumed_by[] using the array_append_unique DB function.
// Sets processed=TRUE only when ALL target_agents have consumed.

async function markConsumed(
  supabase: SupabaseClient,
  event: BusRow,
  agentName: string,
): Promise<void> {
  const updatedConsumedBy = Array.from(new Set([...event.consumed_by, agentName]));
  const allConsumed = event.target_agents.every((t) => updatedConsumedBy.includes(t));

  const { error } = await supabase
    .from("agent_data_bus")
    .update({
      consumed_by: updatedConsumedBy,
      processed:   allConsumed,
    })
    .eq("id", event.id);

  if (error) {
    console.error(`[BusConsumer] Failed to mark consumed for event ${event.id}:`, error.message);
  }
}

// ─── Nightly bus cleanup ──────────────────────────────────────────────────────
// Call from SystemHealthMonitor or a dedicated Deno cron task.
// Removes expired events — bus is append-only but must not grow unbounded.

export async function cleanupExpiredBusEvents(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase
    .rpc("cleanup_agent_bus");

  if (error) {
    console.error(`[BusConsumer] Cleanup failed:`, error.message);
    return 0;
  }

  const deleted = (data as number) ?? 0;
  if (deleted > 0) {
    console.log(`[BusConsumer] Cleaned up ${deleted} expired bus event(s)`);
  }
  return deleted;
}
