// OTXEngine — Sub-agent 14B: WeatherDemandPredictor
// Schedule: every 6 hours (run before micro_demand_forecaster)
// Output: demand_forecasts (weather-driven rows), triggers resource_arbitrage_agent on severe drop
// Source: Open-Meteo API (no key required)

import { supabase } from "../lib/supabase.ts";
import { pingHeartbeat } from "../lib/heartbeat.ts";
import { getCityCoords } from "../lib/geo.ts";
import { publishToBus } from "../orchestration/bus_publisher.ts";

const AGENT_NAME = "WeatherDemandPredictor";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  sector: string;
  geo_city: string;
}

interface HourlyForecast {
  time: string;           // ISO datetime
  temperature_2m: number;
  precipitation: number;  // mm
  wind_speed_10m: number; // km/h
  weather_code: number;   // WMO code
}

interface DemandImpact {
  demandDelta: number;    // % change, e.g. -20 = 20% drop
  condition: string;      // human-readable label
  confidence: number;     // 0-1
}

// ─── WMO weather code → human label ──────────────────────────────────────────

function wmoLabel(code: number): string {
  if (code === 0)              return "clear";
  if (code <= 3)               return "partly_cloudy";
  if (code <= 49)              return "fog";
  if (code <= 59)              return "drizzle";
  if (code <= 69)              return "rain";
  if (code <= 79)              return "snow";
  if (code <= 82)              return "heavy_rain";
  if (code <= 86)              return "heavy_snow";
  if (code >= 95)              return "thunderstorm";
  return "unknown";
}

// ─── Sector-specific demand impact per weather condition ──────────────────────
// Research basis: Israeli consumer mobility studies (approximated)

const SECTOR_WEATHER_IMPACT: Record<string, Record<string, number>> = {
  restaurant: {
    clear:        +5,
    partly_cloudy: +2,
    fog:          -5,
    drizzle:      -8,
    rain:        -18,
    heavy_rain:  -30,
    thunderstorm:-40,
    snow:        -50,
    heavy_snow:  -60,
  },
  fitness: {
    clear:        +8,
    partly_cloudy: +3,
    fog:          -3,
    drizzle:      -5,
    rain:        -12,
    heavy_rain:  -20,
    thunderstorm:-25,
    snow:        -30,
    heavy_snow:  -45,
  },
  beauty: {
    clear:        +3,
    partly_cloudy: +1,
    fog:          -2,
    drizzle:      -6,
    rain:        -15,
    heavy_rain:  -22,
    thunderstorm:-28,
    snow:        -35,
    heavy_snow:  -50,
  },
  local: {
    clear:        +4,
    partly_cloudy: +1,
    fog:          -4,
    drizzle:      -7,
    rain:        -16,
    heavy_rain:  -25,
    thunderstorm:-32,
    snow:        -40,
    heavy_snow:  -55,
  },
};

function computeDemandImpact(sector: string, hourly: HourlyForecast): DemandImpact {
  const condition = wmoLabel(hourly.weather_code);
  const sectorMap = SECTOR_WEATHER_IMPACT[sector] ?? SECTOR_WEATHER_IMPACT.local;
  let delta = sectorMap[condition] ?? 0;

  // Additional modifiers
  if (hourly.temperature_2m > 35) delta -= 10;   // extreme heat
  if (hourly.temperature_2m < 5)  delta -= 8;    // extreme cold
  if (hourly.wind_speed_10m > 50) delta -= 5;    // strong wind

  // Confidence: lower when weather_code is unusual
  const confidence = condition === "unknown" ? 0.55 : 0.78;

  return { demandDelta: Math.max(-80, Math.min(30, delta)), condition, confidence };
}

// ─── Open-Meteo fetch (72h hourly) ────────────────────────────────────────────

async function fetchForecast(lat: number, lon: number): Promise<HourlyForecast[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code` +
    `&forecast_days=3&timezone=Asia%2FJerusalem`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

  const data: {
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation: number[];
      wind_speed_10m: number[];
      weather_code: number[];
    };
  } = await res.json();

  return data.hourly.time.map((t, i) => ({
    time: t,
    temperature_2m: data.hourly.temperature_2m[i],
    precipitation: data.hourly.precipitation[i],
    wind_speed_10m: data.hourly.wind_speed_10m[i],
    weather_code: data.hourly.weather_code[i],
  }));
}

// ─── Upsert demand forecast rows ──────────────────────────────────────────────

async function upsertForecasts(
  businessId: string,
  forecasts: HourlyForecast[],
  impacts: DemandImpact[],
): Promise<void> {
  const rows = forecasts.map((h, i) => {
    const dt = new Date(h.time);
    return {
      business_id:          businessId,
      forecast_date:        dt.toISOString().split("T")[0],
      hour_of_day:          dt.getHours(),
      demand_index:         100 + impacts[i].demandDelta,
      demand_delta_pct:     impacts[i].demandDelta,
      contributing_factors: {
        weather_code: h.weather_code,
        temperature:  h.temperature_2m,
        precipitation: h.precipitation,
        wind_speed:   h.wind_speed_10m,
      },
      weather_condition:    impacts[i].condition,
      confidence_score:     impacts[i].confidence,
      source_url:           "https://open-meteo.com/",
    };
  });

  // Upsert in batches of 50 to stay within Supabase payload limits
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from("demand_forecasts").upsert(
      rows.slice(i, i + BATCH),
      { onConflict: "business_id,forecast_date,hour_of_day" },
    );
    if (error) throw error;
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, sector, geo_city");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let severeDropCount = 0;

  for (const biz of (businesses ?? []) as Business[]) {
    try {
      const coords = getCityCoords(biz.geo_city);
      const forecasts = await fetchForecast(coords.lat, coords.lon);
      const impacts = forecasts.map((h) => computeDemandImpact(biz.sector, h));

      await upsertForecasts(biz.id, forecasts, impacts);
      successCount++;

      // Flag severe demand drops (≤ -15%) for ResourceArbitrageAgent via bus
      const severeHours = impacts.filter((imp) => imp.demandDelta <= -15);
      if (severeHours.length > 0) {
        severeDropCount += severeHours.length;
        const worstDelta = Math.min(...severeHours.map((i) => i.demandDelta));
        console.log(
          `[${AGENT_NAME}] ${biz.id}: ${severeHours.length} hour(s) with demand drop ≤ -15% ` +
          `(worst: ${worstDelta}%)`,
        );
        await publishToBus(supabase, {
          business_id:    biz.id,
          sourceAgent:    AGENT_NAME,
          sourceRecordId: crypto.randomUUID(),
          sourceTable:    "demand_forecasts",
          event_type:     "demand_gap_forecast",
          payload: { demand_delta: worstDelta, severe_hours: severeHours.length },
        }).catch(() => {/* non-critical */});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed for business ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Forecast failed for ${biz.id}: ${msg}`);
      errorCount++;
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} businesses failed` : undefined,
  );
  console.log(
    `[${AGENT_NAME}] Done. Processed: ${successCount}, Errors: ${errorCount}, ` +
    `Severe drop hours flagged: ${severeDropCount}. Ping: ${now}`,
  );
}

// deno-lint-ignore no-explicit-any
export async function runWeatherDemandPredictor(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
