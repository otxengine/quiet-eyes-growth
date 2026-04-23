// OTXEngine — Agent 6: EventImpactEngine
// Trigger: pg_notify on events_raw insert + nightly full recompute
// Output: event_opportunities
// Impact score is ADDITIVE: 0.5·sector + 0.3·geo + 0.2·historical (NEVER multiplicative)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "EventImpactEngine";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface EventRaw {
  event_id: string;
  event_name: string;
  event_date: string;
  geo: string | null;
  source_url: string;
  confidence_score: number;
}

interface Business {
  id: string;
  sector: "restaurant" | "fitness" | "beauty" | "local";
  geo_city: string;
}

interface MemoryRow {
  success_rate: number | null;
  sample_size: number | null;
}

interface EventOpportunityRow {
  event_id: string;
  business_id: string;
  impact_score: number;
  sector_relevance: number;
  geo_relevance: number;
  historical_weight: number;
  source_url: string;
  confidence_score: number;
}

// ─── Impact score formula — ADDITIVE (not multiplicative) ─────────────────────

function computeImpactScore(sector: number, geo: number, historical: number): number {
  // NEVER use sector * geo * historical — breaks when any component = 0
  return 0.5 * sector + 0.3 * geo + 0.2 * historical;
}

// ─── Sector relevance (event × business sector) ────────────────────────────────

const EVENT_SECTOR_TERMS: Record<Business["sector"], string[]> = {
  restaurant: ["food", "eat", "restaurant", "culinary", "אוכל", "מסעדה", "שף", "פסח", "ראש השנה", "חנוכה"],
  fitness:    ["sport", "fitness", "run", "marathon", "yoga", "gym", "כושר", "ספורט", "אימון", "ריצה"],
  beauty:     ["beauty", "wellness", "spa", "יופי", "אופנה", "סטייל", "fashion"],
  local:      ["community", "fair", "festival", "market", "local", "מקומי", "שוק", "פסטיבל", "ירידה"],
};

function computeSectorRelevance(eventName: string, sector: Business["sector"]): number {
  const lower = eventName.toLowerCase();
  const terms = EVENT_SECTOR_TERMS[sector];
  const matches = terms.filter((t) => lower.includes(t.toLowerCase())).length;
  if (matches === 0) return 0.2; // minimum relevance — events have some universal value
  return Math.min(0.2 + matches * 0.2, 1.0);
}

// ─── Geo relevance ────────────────────────────────────────────────────────────

const REGION_MAP: Record<string, string> = {
  tel_aviv: "center", ramat_gan: "center", givatayim: "center", bat_yam: "center",
  bnei_brak: "center", petah_tikva: "center", raanana: "center", herzliya: "center",
  jerusalem: "jerusalem", beit_shemesh: "jerusalem",
  haifa: "north", krayot: "north", nahariya: "north", acre: "north",
  beer_sheva: "south", eilat: "south", ashdod: "south", ashkelon: "south",
};

function computeGeoRelevance(eventGeo: string | null, bizGeo: string): number {
  if (!eventGeo || eventGeo === "IL") return 0.3; // national event
  const normalizeGeo = (g: string) => g.toLowerCase().replace(/ /g, "_");
  const eGeo = normalizeGeo(eventGeo);
  const bGeo = normalizeGeo(bizGeo);
  if (eGeo === bGeo) return 1.0;        // exact city match
  const rE = REGION_MAP[eGeo];
  const rB = REGION_MAP[bGeo];
  if (rE && rB && rE === rB) return 0.7; // same region
  return 0.3;                             // national / far
}

// ─── Historical weight from global_memory_aggregates ─────────────────────────

async function fetchHistoricalWeight(
  sector: string,
  geo: string,
): Promise<number> {
  const { data } = await supabase
    .from("global_memory_aggregates")
    .select("success_rate, sample_size")
    .eq("agg_type", "geo")
    .eq("dimension_key", `${geo}_event`)
    .eq("action_type", "promote")
    .eq("is_valid", true)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    // Also try sector-level fallback
    const { data: sectorData } = await supabase
      .from("global_memory_aggregates")
      .select("success_rate, sample_size")
      .eq("agg_type", "sector")
      .eq("dimension_key", sector)
      .eq("action_type", "promote")
      .eq("is_valid", true)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (sectorData as MemoryRow | null)?.success_rate ?? 0.5; // neutral prior
  }

  return (data as MemoryRow).success_rate ?? 0.5;
}

// ─── Load events for next 30 days not yet scored ──────────────────────────────

async function loadUnprocessedEvents(): Promise<EventRaw[]> {
  const today = new Date().toISOString().split("T")[0];
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Find already-processed event_ids in event_opportunities
  const { data: processed } = await supabase
    .from("event_opportunities")
    .select("event_id");

  const processedIds = new Set((processed ?? []).map((r: { event_id: string }) => r.event_id));

  const { data, error } = await supabase
    .from("events_raw")
    .select("event_id, event_name, event_date, geo, source_url, confidence_score")
    .gte("event_date", today)
    .lte("event_date", futureDate);

  if (error) throw error;

  return ((data ?? []) as EventRaw[]).filter((e) => !processedIds.has(e.event_id));
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  let events: EventRaw[];
  let businesses: Business[];

  try {
    const [evtResult, bizResult] = await Promise.all([
      loadUnprocessedEvents(),
      supabase.from("businesses").select("id, sector, geo_city"),
    ]);

    events = evtResult;
    if (bizResult.error) throw bizResult.error;
    businesses = (bizResult.data ?? []) as Business[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, msg);
    return;
  }

  if (events.length === 0 || businesses.length === 0) {
    console.log(`[${AGENT_NAME}] No unprocessed events or businesses`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const rows: EventOpportunityRow[] = [];

  for (const event of events) {
    for (const biz of businesses) {
      const sectorRelevance = computeSectorRelevance(event.event_name, biz.sector);
      const geoRelevance = computeGeoRelevance(event.geo, biz.geo_city);
      const historicalWeight = await fetchHistoricalWeight(biz.sector, biz.geo_city);

      // ADDITIVE formula (not multiplicative)
      const impactScore = computeImpactScore(sectorRelevance, geoRelevance, historicalWeight);

      rows.push({
        event_id: event.event_id,
        business_id: biz.id,
        impact_score: Math.round(impactScore * 100) / 100,
        sector_relevance: Math.round(sectorRelevance * 100) / 100,
        geo_relevance: Math.round(geoRelevance * 100) / 100,
        historical_weight: Math.round(historicalWeight * 100) / 100,
        source_url: event.source_url,
        confidence_score: Math.round(event.confidence_score * 100) / 100,
      });
    }
  }

  if (rows.length === 0) {
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  // Batch insert in chunks of 100
  let insertedTotal = 0;
  const CHUNK_SIZE = 100;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error, count } = await supabase
      .from("event_opportunities")
      .insert(chunk, { count: "exact" });

    if (error) {
      console.error(`[${AGENT_NAME}] Insert chunk failed:`, error.message);
    } else {
      insertedTotal += count ?? chunk.length;
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(`[${AGENT_NAME}] Done. Inserted ${insertedTotal} event opportunities. Ping: ${now}`);
}

if (import.meta.main) {
  await run();
}
