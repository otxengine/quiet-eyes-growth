// OTXEngine — Agent 5: SectorTrendRadar
// Schedule: every 60 minutes
// Output: sector_trends (Z-score spike detection)
// Enrichment: Tavily fetches real article URL when spike detected

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "SectorTrendRadar";
const Z_THRESHOLD = parseFloat(Deno.env.get("Z_THRESHOLD") ?? "2.0");
const MIN_SAMPLES = 10;

const CITY_HEBREW: Record<string, string> = {
  tel_aviv: "תל אביב", bnei_brak: "בני ברק", jerusalem: "ירושלים",
  haifa: "חיפה", beer_sheva: "באר שבע", ramat_gan: "רמת גן",
  petah_tikva: "פתח תקווה", herzliya: "הרצליה", raanana: "רעננה",
};

const SECTOR_HEBREW: Record<string, string> = {
  restaurant: "מסעדה אוכל", fitness: "חדר כושר ספורט",
  beauty: "יופי ספא", local: "עסק מקומי",
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SectorTrendRow {
  sector:          string;
  geo:             string | null;
  z_score:         number;
  rolling_mean:    number;
  rolling_std:     number;
  spike_detected:  boolean;
  detected_at_utc: string;
  source_url:      string;
  confidence_score: number;
}

interface SignalVolume {
  sector:      string;
  geo:         string | null;
  hour_bucket: string;
  volume:      number;
}

// ─── Z-score ──────────────────────────────────────────────────────────────────

function computeZScore(currentVol: number, mean: number, std: number): number {
  if (std < 0.0001) return 0;
  return (currentVol - mean) / std;
}

function rollingStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

// ─── Tavily: fetch real article URL for spike explanation ─────────────────────

async function fetchSpikeArticleUrl(
  sector: string,
  geo: string | null,
  tavilyKey: string,
): Promise<string | null> {
  const cityName = geo ? (CITY_HEBREW[geo] ?? geo.replace(/_/g, " ")) : "ישראל";
  const sectorName = SECTOR_HEBREW[sector] ?? sector;
  const query = `${sectorName} ${cityName} מגמה עדכון`;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:      tavilyKey,
        query,
        search_depth: "basic",
        max_results:  1,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: { results?: Array<{ url: string; title: string }> } = await res.json();
    const first = data.results?.[0];
    if (!first?.url) return null;
    console.log(`[${AGENT_NAME}] Spike article for ${sector}/${geo}: "${first.title}"`);
    return first.url;
  } catch {
    return null;
  }
}

// ─── Fetch signal volumes ─────────────────────────────────────────────────────

async function fetchSignalVolumes(): Promise<SignalVolume[]> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("signals_raw")
    .select(`business_id, geo, detected_at_utc, businesses!inner ( sector )`)
    .gte("detected_at_utc", since)
    .order("detected_at_utc", { ascending: true });

  if (error) throw error;

  const volumeMap = new Map<string, SignalVolume>();

  for (const row of (data ?? []) as Array<{
    business_id: string;
    geo: string | null;
    detected_at_utc: string;
    businesses: { sector: string };
  }>) {
    const sector = row.businesses.sector;
    const geo = row.geo ?? null;
    const d = new Date(row.detected_at_utc);
    const hourBucket = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
    const key = `${sector}|${geo ?? "all"}|${hourBucket}`;

    const existing = volumeMap.get(key);
    if (existing) {
      existing.volume += 1;
    } else {
      volumeMap.set(key, { sector, geo, hour_bucket: hourBucket, volume: 1 });
    }
  }

  return Array.from(volumeMap.values());
}

// ─── Group into rolling windows ───────────────────────────────────────────────

interface SectorGeoGroup {
  sector:        string;
  geo:           string | null;
  volumeHistory: number[];
  currentVolume: number;
}

function groupIntoWindows(volumes: SignalVolume[]): SectorGeoGroup[] {
  const groupMap = new Map<string, SignalVolume[]>();
  for (const v of volumes) {
    const key = `${v.sector}|${v.geo ?? "all"}`;
    const group = groupMap.get(key) ?? [];
    group.push(v);
    groupMap.set(key, group);
  }

  const result: SectorGeoGroup[] = [];
  for (const [key, vols] of groupMap.entries()) {
    const sorted = vols.sort((a, b) => a.hour_bucket.localeCompare(b.hour_bucket));
    const [sector, geo] = key.split("|");
    result.push({
      sector,
      geo:           geo === "all" ? null : geo,
      volumeHistory: sorted.slice(0, -1).map((v) => v.volume),
      currentVolume: sorted[sorted.length - 1]?.volume ?? 0,
    });
  }
  return result;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const tavilyKey = Deno.env.get("TAVILY_API_KEY");
  const serpKey   = Deno.env.get("SERPAPI_KEY");

  let volumes: SignalVolume[];
  try {
    volumes = await fetchSignalVolumes();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, msg);
    return;
  }

  if (volumes.length === 0) {
    console.log(`[${AGENT_NAME}] No signal volume data — nothing to score`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const groups = groupIntoWindows(volumes);
  const rows: SectorTrendRow[] = [];
  const now = new Date().toISOString();

  for (const group of groups) {
    const { mean, std } = rollingStats(group.volumeHistory);
    const hasSufficientSamples = group.volumeHistory.length >= MIN_SAMPLES;
    const z = hasSufficientSamples ? computeZScore(group.currentVolume, mean, std) : 0;
    const spikeDetected = hasSufficientSamples && z > Z_THRESHOLD;

    const confidenceScore = hasSufficientSamples
      ? Math.min(0.5 + (group.volumeHistory.length / 48) * 0.4, 0.95)
      : 0.4;

    // Source URL: use Tavily article when spike is real — much more useful than a trends URL
    let sourceUrl: string;
    if (spikeDetected && tavilyKey) {
      sourceUrl = (await fetchSpikeArticleUrl(group.sector, group.geo, tavilyKey)) ??
        buildTrendsUrl(group.sector, group.geo, serpKey);
    } else {
      sourceUrl = buildTrendsUrl(group.sector, group.geo, serpKey);
    }

    rows.push({
      sector:           group.sector,
      geo:              group.geo,
      z_score:          Math.round(z * 100) / 100,
      rolling_mean:     Math.round(mean * 100) / 100,
      rolling_std:      Math.round(std * 100) / 100,
      spike_detected:   spikeDetected,
      detected_at_utc:  now,
      source_url:       sourceUrl,
      confidence_score: Math.round(confidenceScore * 100) / 100,
    });

    if (spikeDetected) {
      console.log(
        `[${AGENT_NAME}] SPIKE: sector=${group.sector} geo=${group.geo} z=${z.toFixed(2)} vol=${group.currentVolume} mean=${mean.toFixed(2)}`,
      );
    }
  }

  if (rows.length === 0) {
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const { error } = await supabase.from("sector_trends").insert(rows);
  if (error) {
    console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, error.message);
    return;
  }

  const spikes = rows.filter((r) => r.spike_detected).length;
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(`[${AGENT_NAME}] Done. Wrote ${rows.length} trend rows (${spikes} spikes). Ping: ${now}`);
}

function buildTrendsUrl(sector: string, geo: string | null, _serpKey?: string): string {
  const query = encodeURIComponent(`${sector} ${geo ?? "israel"} trend`);
  return `https://trends.google.com/trends/explore?q=${query}&geo=IL`;
}

// deno-lint-ignore no-explicit-any
export async function runSectorTrendRadar(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
