// OTXEngine — Agent 4: IntentClassification
// Trigger: pg_notify on signals_raw insert OR polling every 5 min
// Output: classified_signals

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "IntentClassification";
const INTENT_THRESHOLD = parseFloat(Deno.env.get("INTENT_THRESHOLD") ?? "0.65");

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SignalRaw {
  signal_id: string;
  business_id: string;
  source_type: string;
  source_url: string;
  raw_text: string;
  geo: string;
  detected_at_utc: string;
  confidence_score: number;
}

interface BusinessProfile {
  business_id: string;
  sector: string | null;
  geo: string | null;
  keywords: string[] | null;
  embedding_vector: number[] | null;
}

interface ClassifiedSignalRow {
  signal_id: string;
  business_id: string;
  intent_score: number;
  sector_match_score: number;
  geo_match_score: number;
  qualified: boolean;
  processed_at: string;
  source_url: string;
  confidence_score: number;
}

// ─── Intent keyword scoring ───────────────────────────────────────────────────

const INTENT_KEYWORDS: Record<string, number> = {
  // High-intent purchase signals (Hebrew + English)
  "אני מחפש": 0.9, "אני צריך": 0.9, "מישהו ממליץ": 0.85, "מחפש המלצה": 0.85,
  "איפה אפשר": 0.8, "כמה עולה": 0.8, "מחיר": 0.7, "להזמין": 0.85,
  "looking for": 0.85, "recommend": 0.8, "price": 0.7, "how much": 0.75,
  "where can i": 0.8, "best": 0.65, "need": 0.75, "want": 0.7,
  "book": 0.85, "reserve": 0.85, "appointment": 0.9, "תור": 0.9,
  "חדש": 0.5, "new": 0.5, "opening": 0.6, "פתיחה": 0.6,
};

function computeIntentScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let maxScore = 0;
  let matchCount = 0;

  // Check global intent keywords
  for (const [kw, score] of Object.entries(INTENT_KEYWORDS)) {
    if (lower.includes(kw.toLowerCase())) {
      maxScore = Math.max(maxScore, score);
      matchCount++;
    }
  }

  // Check business-specific keywords from profile
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      matchCount++;
      maxScore = Math.max(maxScore, 0.6);
    }
  }

  // Frequency boost: more keyword matches = higher confidence
  const frequencyBoost = Math.min(matchCount * 0.05, 0.15);
  return Math.min(maxScore + frequencyBoost, 1.0);
}

// ─── Sector match scoring (cosine-like, no embedding required) ────────────────

const SECTOR_TERMS: Record<string, string[]> = {
  restaurant: ["מסעדה", "אוכל", "שף", "תפריט", "restaurant", "food", "menu", "chef", "eat", "dinner", "lunch", "breakfast", "pizza", "burger", "sushi"],
  fitness:    ["כושר", "חדר כושר", "ספורט", "אימון", "gym", "fitness", "workout", "sport", "yoga", "pilates", "crossfit", "marathon", "run"],
  beauty:     ["יופי", "ספא", "תספורת", "מניקור", "beauty", "spa", "hair", "nail", "salon", "makeup", "skin", "facial", "waxing"],
  local:      ["מקומי", "שכונה", "עסק", "שירות", "local", "community", "service", "neighborhood", "area"],
};

function computeSectorMatchScore(text: string, sector: string): number {
  const lower = text.toLowerCase();
  const terms = SECTOR_TERMS[sector] ?? [];
  if (terms.length === 0) return 0.3;

  const matches = terms.filter((t) => lower.includes(t.toLowerCase())).length;
  return Math.min(matches / terms.length * 3, 1.0); // scale up — typically < 10% of terms match
}

// ─── Geo match scoring ────────────────────────────────────────────────────────

const REGION_MAP: Record<string, string> = {
  // All Israeli city pairs → region group
  tel_aviv: "center", ramat_gan: "center", givatayim: "center", bat_yam: "center",
  bnei_brak: "center", petah_tikva: "center", raanana: "center", herzliya: "center",
  jerusalem: "jerusalem", beit_shemesh: "jerusalem",
  haifa: "north", krayot: "north", nahariya: "north", acre: "north",
  beer_sheva: "south", eilat: "south", ashdod: "south", ashkelon: "south",
};

function sameRegion(geoA: string, geoB: string): boolean {
  const rA = REGION_MAP[geoA.toLowerCase().replace(/ /g, "_")];
  const rB = REGION_MAP[geoB.toLowerCase().replace(/ /g, "_")];
  return Boolean(rA && rB && rA === rB);
}

function geoScore(signalGeo: string, bizGeo: string): number {
  if (!signalGeo || !bizGeo) return 0.3;
  if (signalGeo.toLowerCase() === bizGeo.toLowerCase()) return 1.0;
  if (sameRegion(signalGeo, bizGeo)) return 0.6;
  return 0.1;
}

// ─── Load unprocessed signals ─────────────────────────────────────────────────

async function loadUnprocessedSignals(): Promise<SignalRaw[]> {
  // Find signal_ids already in classified_signals
  const { data: processed } = await supabase
    .from("classified_signals")
    .select("signal_id");

  const processedIds = new Set((processed ?? []).map((r: { signal_id: string }) => r.signal_id));

  const { data: signals, error } = await supabase
    .from("signals_raw")
    .select("*")
    .order("detected_at_utc", { ascending: false })
    .limit(500);

  if (error) throw error;

  return ((signals ?? []) as SignalRaw[]).filter((s) => !processedIds.has(s.signal_id));
}

// ─── Load business profiles (latest version per business_id) ─────────────────

async function loadProfiles(): Promise<Map<string, BusinessProfile>> {
  const { data, error } = await supabase
    .from("otx_business_profiles")
    .select("business_id, sector, geo, keywords, embedding_vector")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const profileMap = new Map<string, BusinessProfile>();
  for (const p of (data ?? []) as BusinessProfile[]) {
    if (!profileMap.has(p.business_id)) profileMap.set(p.business_id, p);
  }
  return profileMap;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  let signals: SignalRaw[];
  let profiles: Map<string, BusinessProfile>;

  try {
    [signals, profiles] = await Promise.all([loadUnprocessedSignals(), loadProfiles()]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, msg);
    return;
  }

  if (signals.length === 0) {
    console.log(`[${AGENT_NAME}] No unprocessed signals`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const rows: ClassifiedSignalRow[] = [];

  for (const signal of signals) {
    const profile = profiles.get(signal.business_id);
    const keywords = profile?.keywords ?? [];
    const sector = profile?.sector ?? "local";
    const bizGeo = profile?.geo ?? "";

    const intentScore = computeIntentScore(signal.raw_text, keywords);
    const sectorMatchScore = computeSectorMatchScore(signal.raw_text, sector);
    const geoMatchScore = geoScore(signal.geo ?? "", bizGeo);
    const qualified = intentScore > INTENT_THRESHOLD;

    rows.push({
      signal_id: signal.signal_id,
      business_id: signal.business_id,
      intent_score: Math.round(intentScore * 100) / 100,
      sector_match_score: Math.round(sectorMatchScore * 100) / 100,
      geo_match_score: Math.round(geoMatchScore * 100) / 100,
      qualified,
      processed_at: new Date().toISOString(),
      source_url: signal.source_url,
      confidence_score: signal.confidence_score,
    });
  }

  // Batch insert in chunks of 100
  const CHUNK_SIZE = 100;
  let insertedTotal = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error, count } = await supabase
      .from("classified_signals")
      .insert(chunk, { count: "exact" });

    if (error) {
      console.error(`[${AGENT_NAME}] Insert chunk failed:`, error.message);
    } else {
      insertedTotal += count ?? chunk.length;
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(
    `[${AGENT_NAME}] Done. Classified ${insertedTotal} signals (${rows.filter((r) => r.qualified).length} qualified). Ping: ${now}`,
  );
}

// deno-lint-ignore no-explicit-any
export async function runIntentClassification(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
