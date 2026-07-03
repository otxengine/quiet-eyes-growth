// OTXEngine — Agent 5: SectorTrendRadar
// Schedule: every 60 minutes
// Output: sector_trends (Z-score spike detection)
// Enrichment: Tavily fetches real article URL when spike detected
//
// v2 — Extended rolling window (30 days) + seasonal pattern detection
// Detects trends DAYS/WEEKS before peak, not just hours.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "SectorTrendRadar";
const Z_THRESHOLD = parseFloat(Deno.env.get("Z_THRESHOLD") ?? "2.0");

// Rolling window in hours — configurable per tier via env, default 30 days
const WINDOW_HOURS = parseInt(Deno.env.get("TREND_WINDOW_HOURS") ?? "720"); // 720h = 30 days
const MIN_SAMPLES = 10; // minimum hourly buckets to compute z-score

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
  sector:               string;
  geo:                  string | null;
  z_score:              number;
  rolling_mean:         number;
  rolling_std:          number;
  spike_detected:       boolean;
  detected_at_utc:      string;
  source_url:           string;
  confidence_score:     number;
  seasonal_adjustment?: number; // multiplicative factor applied before z-score
  days_to_peak_est?:   number;  // estimated days until full peak
}

interface SignalVolume {
  sector:      string;
  geo:         string | null;
  hour_bucket: string; // ISO format: "YYYY-MM-DDTHH"
  volume:      number;
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

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

// ─── Seasonal pattern detection ───────────────────────────────────────────────
//
// Strategy: compare the trailing 7-day average for this DOW/time slot
// against the overall mean. The ratio is the seasonal factor.
// A factor > 1 means "this time slot normally has higher volume" — we
// deflate the current observation before computing z-score so we don't
// fire false positives on predictable weekly cycles.

function computeSeasonalFactor(
  volumes: SignalVolume[],
  currentBucket: string,
): number {
  if (volumes.length < 24 * 7) return 1.0; // not enough data for seasonal calc

  // Parse DOW and hour from bucket
  const d = new Date(`${currentBucket}:00:00Z`);
  const dow = d.getUTCDay();   // 0=Sun … 6=Sat
  const hour = d.getUTCHours();

  // Find all historical buckets on the same DOW+hour
  const sameDowHour = volumes.filter((v) => {
    const vd = new Date(`${v.hour_bucket}:00:00Z`);
    return vd.getUTCDay() === dow && vd.getUTCHours() === hour;
  });

  if (sameDowHour.length < 2) return 1.0;

  const { mean: dowMean } = rollingStats(sameDowHour.map((v) => v.volume));
  const { mean: overallMean } = rollingStats(volumes.map((v) => v.volume));

  if (overallMean < 0.0001) return 1.0;
  return dowMean / overallMean; // seasonal multiplier
}

// ─── Linear trend slope (Theil-Sen simplified) ───────────────────────────────
// Estimates how fast volume is growing over recent days.
// Positive slope = growing trend → can estimate days to peak.

function estimateDaysToPeak(volumes: SignalVolume[]): number | undefined {
  if (volumes.length < 48) return undefined; // need 2+ days

  // Use daily aggregates (last 14 days)
  const dailyMap = new Map<string, number>();
  for (const v of volumes) {
    const day = v.hour_bucket.slice(0, 10); // "YYYY-MM-DD"
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + v.volume);
  }

  const days = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14);

  if (days.length < 3) return undefined;

  const n = days.length;
  const xs = days.map((_, i) => i);
  const ys = days.map(([, v]) => v);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const den = xs.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);

  if (Math.abs(den) < 0.0001) return undefined;
  const slope = num / den; // volume units per day

  if (slope <= 0) return undefined; // not growing

  // Estimate days until volume doubles current rate (rough peak proxy)
  const currentDaily = ys[ys.length - 1];
  const peakProxy = yMean * 3; // 3× mean = approximate peak
  if (currentDaily >= peakProxy) return 0; // already at peak

  const daysLeft = (peakProxy - currentDaily) / slope;
  return Math.max(1, Math.round(daysLeft));
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

// ─── Fetch signal volumes (30-day window) ────────────────────────────────────

async function fetchSignalVolumes(): Promise<SignalVolume[]> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

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
  volumeHistory: number[];        // all buckets except latest
  currentVolume: number;
  allVolumes:    SignalVolume[];   // full slice — used for seasonal calc
  currentBucket: string;
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
      allVolumes:    sorted,
      currentBucket: sorted[sorted.length - 1]?.hour_bucket ?? "",
    });
  }
  return result;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()} (window=${WINDOW_HOURS}h)`);

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
    // ── Seasonal adjustment ──────────────────────────────────────────────────
    const seasonalFactor = computeSeasonalFactor(group.allVolumes, group.currentBucket);
    // Divide current volume by seasonal factor before z-scoring to remove
    // predictable weekly patterns and focus on genuine anomalies.
    const seasonallyAdjustedVolume = seasonalFactor > 0
      ? group.currentVolume / seasonalFactor
      : group.currentVolume;

    // ── Z-score on adjusted value ────────────────────────────────────────────
    const { mean, std } = rollingStats(group.volumeHistory);
    const hasSufficientSamples = group.volumeHistory.length >= MIN_SAMPLES;
    const z = hasSufficientSamples ? computeZScore(seasonallyAdjustedVolume, mean, std) : 0;
    const spikeDetected = hasSufficientSamples && z > Z_THRESHOLD;

    // ── Days to peak estimation ──────────────────────────────────────────────
    const daysToPeak = spikeDetected
      ? estimateDaysToPeak(group.allVolumes)
      : undefined;

    // ── Confidence score ─────────────────────────────────────────────────────
    // More history → higher confidence. Max out at 0.95.
    const maxHistorySamples = WINDOW_HOURS; // one per hour at most
    const confidenceScore = hasSufficientSamples
      ? Math.min(0.5 + (group.volumeHistory.length / maxHistorySamples) * 0.45, 0.95)
      : 0.4;

    // ── Source URL ───────────────────────────────────────────────────────────
    let sourceUrl: string;
    if (spikeDetected && tavilyKey) {
      sourceUrl = (await fetchSpikeArticleUrl(group.sector, group.geo, tavilyKey)) ??
        buildTrendsUrl(group.sector, group.geo, serpKey);
    } else {
      sourceUrl = buildTrendsUrl(group.sector, group.geo, serpKey);
    }

    const row: SectorTrendRow = {
      sector:              group.sector,
      geo:                 group.geo,
      z_score:             Math.round(z * 100) / 100,
      rolling_mean:        Math.round(mean * 100) / 100,
      rolling_std:         Math.round(std * 100) / 100,
      spike_detected:      spikeDetected,
      detected_at_utc:     now,
      source_url:          sourceUrl,
      confidence_score:    Math.round(confidenceScore * 100) / 100,
      seasonal_adjustment: Math.round(seasonalFactor * 1000) / 1000,
    };

    if (daysToPeak !== undefined) {
      row.days_to_peak_est = daysToPeak;
    }

    rows.push(row);

    if (spikeDetected) {
      const peakStr = daysToPeak != null ? ` ~${daysToPeak}d to peak` : "";
      console.log(
        `[${AGENT_NAME}] SPIKE: sector=${group.sector} geo=${group.geo} z=${z.toFixed(2)} vol=${group.currentVolume} adj=${seasonallyAdjustedVolume.toFixed(1)} mean=${mean.toFixed(2)} seasonal=${seasonalFactor.toFixed(2)}${peakStr}`,
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
  console.log(`[${AGENT_NAME}] Done. Wrote ${rows.length} trend rows (${spikes} spikes, window=${WINDOW_HOURS}h). Ping: ${now}`);
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
