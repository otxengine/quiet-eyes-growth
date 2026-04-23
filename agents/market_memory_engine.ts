// OTXEngine — Agent 8: MarketMemoryEngine
// Schedule: nightly at 02:00
// Output: global_memory_aggregates (4 layers)
// CRITICAL: partial failure writes is_valid=FALSE; never invalidates old is_valid=TRUE rows

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "MarketMemoryEngine";
const LAMBDA = 0.05; // recency decay constant

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ActionRow {
  business_id: string;
  action_type: "promote" | "respond" | "alert" | "hold";
  action_score: number;
  stale_memory_flag: boolean;
  created_at: string;
  businesses?: { sector: string; geo_city: string; price_tier: string | null };
}

interface AggregateRow {
  agg_type: "global" | "sector" | "geo" | "price_tier";
  dimension_key: string;
  action_type: string;
  success_rate: number;
  sample_size: number;
  computed_at: string;
  is_valid: boolean;
}

// ─── Recency decay ────────────────────────────────────────────────────────────

function recencyWeight(daysSince: number, lambda = LAMBDA): number {
  return Math.exp(-lambda * daysSince);
}

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.max(0, (now - then) / (1000 * 60 * 60 * 24));
}

// ─── Weighted success rate ─────────────────────────────────────────────────────
// "Success" = action_score > 0.6 (threshold used in ActionScoringService)
// Weight each action by recency decay

function weightedSuccessRate(
  actions: ActionRow[],
): { successRate: number; sampleSize: number } {
  if (actions.length === 0) return { successRate: 0.5, sampleSize: 0 };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const a of actions) {
    const w = recencyWeight(daysSince(a.created_at));
    const success = a.action_score > 0.6 ? 1 : 0;
    weightedSum += success * w;
    totalWeight += w;
  }

  const rate = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  return {
    successRate: Math.round(rate * 1000) / 1000,
    sampleSize: actions.length,
  };
}

// ─── Load all actions with business join ─────────────────────────────────────

async function loadActions(): Promise<ActionRow[]> {
  // Look back 90 days for meaningful aggregation
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("actions_recommended")
    .select(`
      business_id,
      action_type,
      action_score,
      stale_memory_flag,
      created_at,
      businesses!inner ( sector, geo_city, price_tier )
    `)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ActionRow[];
}

// ─── Compute all 4 aggregation layers ────────────────────────────────────────

function computeAggregates(actions: ActionRow[]): AggregateRow[] {
  const now = new Date().toISOString();
  const rows: AggregateRow[] = [];
  const actionTypes: Array<"promote" | "respond" | "alert" | "hold"> = ["promote", "respond", "alert", "hold"];

  // Layer A — Global: SuccessRate(action_type) across all businesses
  for (const at of actionTypes) {
    const filtered = actions.filter((a) => a.action_type === at);
    const { successRate, sampleSize } = weightedSuccessRate(filtered);
    rows.push({
      agg_type: "global",
      dimension_key: "all",
      action_type: at,
      success_rate: successRate,
      sample_size: sampleSize,
      computed_at: now,
      is_valid: true,
    });
  }

  // Layer B — Sector: SuccessRate(sector, action_type)
  const sectors = new Set(actions.map((a) => a.businesses?.sector).filter(Boolean) as string[]);
  for (const sector of sectors) {
    for (const at of actionTypes) {
      const filtered = actions.filter(
        (a) => a.businesses?.sector === sector && a.action_type === at,
      );
      const { successRate, sampleSize } = weightedSuccessRate(filtered);
      rows.push({
        agg_type: "sector",
        dimension_key: sector,
        action_type: at,
        success_rate: successRate,
        sample_size: sampleSize,
        computed_at: now,
        is_valid: true,
      });
    }
  }

  // Layer C — Geo: RevenueLift(geo, event_type) approximated via geo × promote
  const geos = new Set(actions.map((a) => a.businesses?.geo_city).filter(Boolean) as string[]);
  for (const geo of geos) {
    // Special dimension: geo_event — RevenueLift proxy
    const filtered = actions.filter(
      (a) => a.businesses?.geo_city === geo && a.action_type === "promote",
    );
    const { successRate, sampleSize } = weightedSuccessRate(filtered);
    rows.push({
      agg_type: "geo",
      dimension_key: `${geo}_event`,
      action_type: "promote",
      success_rate: successRate,
      sample_size: sampleSize,
      computed_at: now,
      is_valid: true,
    });

    // Also store general geo success per action type
    for (const at of actionTypes) {
      const filteredAt = actions.filter(
        (a) => a.businesses?.geo_city === geo && a.action_type === at,
      );
      const stats = weightedSuccessRate(filteredAt);
      rows.push({
        agg_type: "geo",
        dimension_key: geo,
        action_type: at,
        success_rate: stats.successRate,
        sample_size: stats.sampleSize,
        computed_at: now,
        is_valid: true,
      });
    }
  }

  // Layer D — PriceTier: ConversionPattern(price_tier, action_type)
  const tiers = new Set(
    actions.map((a) => a.businesses?.price_tier).filter(Boolean) as string[],
  );
  for (const tier of tiers) {
    for (const at of actionTypes) {
      const filtered = actions.filter(
        (a) => a.businesses?.price_tier === tier && a.action_type === at,
      );
      const { successRate, sampleSize } = weightedSuccessRate(filtered);
      rows.push({
        agg_type: "price_tier",
        dimension_key: tier,
        action_type: at,
        success_rate: successRate,
        sample_size: sampleSize,
        computed_at: now,
        is_valid: true,
      });
    }
  }

  return rows;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  let actions: ActionRow[];
  try {
    actions = await loadActions();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, msg);
    return;
  }

  const rows = computeAggregates(actions);

  if (rows.length === 0) {
    console.log(`[${AGENT_NAME}] No data to aggregate`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  // CRITICAL: partial failure → write new rows with is_valid=FALSE
  // NEVER mark old is_valid=TRUE rows as invalid — they remain the fallback
  const CHUNK_SIZE = 50;
  let allSucceeded = true;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("global_memory_aggregates").insert(chunk);

    if (error) {
      console.error(`[${AGENT_NAME}] Chunk ${i / CHUNK_SIZE} failed:`, error.message);
      allSucceeded = false;

      // Write same chunk with is_valid=FALSE to signal partial failure
      const invalidChunk = chunk.map((r) => ({ ...r, is_valid: false }));
      await supabase.from("global_memory_aggregates").insert(invalidChunk).catch((e2) => {
        console.error(`[${AGENT_NAME}] Failed to write invalid marker:`, e2.message);
      });
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    allSucceeded ? "OK" : "DELAYED",
    now,
    allSucceeded ? undefined : "Partial batch failure — some rows marked is_valid=FALSE",
  );
  console.log(
    `[${AGENT_NAME}] Done. ${rows.length} aggregates written (all_ok=${allSucceeded}). Ping: ${now}`,
  );

  // Notify all consumers that memory has been updated (closes the learning loop)
  if (allSucceeded && rows.length > 0) {
    const bizIds = new Set(actions.map((a) => a.business_id));
    for (const bizId of bizIds) {
      await publishToBus(supabase, {
        business_id:    bizId,
        sourceAgent:    AGENT_NAME,
        sourceRecordId: crypto.randomUUID(),
        sourceTable:    "global_memory_aggregates",
        event_type:     "memory_updated",
        payload:        { rows_written: rows.length, all_succeeded: allSucceeded },
      }).catch(() => {/* non-critical */});
    }
  }
}

// deno-lint-ignore no-explicit-any
export async function runMarketMemoryEngine(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
