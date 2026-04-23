// OTXEngine — Sub-agent 14C: MicroDemandForecaster
// Schedule: every 6 hours (after weather_demand_predictor)
// Output: demand_forecasts (refined rows fusing weather + local events + payday/holiday)
// Depends on: demand_forecasts (weather rows), hyper_local_events

import { supabase } from "../lib/supabase.ts";
import { pingHeartbeat } from "../lib/heartbeat.ts";

const AGENT_NAME = "MicroDemandForecaster";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  sector: string;
  geo_city: string;
}

interface WeatherForecastRow {
  forecast_date: string;
  hour_of_day: number;
  demand_delta_pct: number;
  weather_condition: string;
  confidence_score: number;
}

interface LocalEventRow {
  event_datetime: string;
  event_type: string;
  expected_attendance: number | null;
  distance_meters: number;
  confidence_score: number;
}

// ─── Israeli payday calendar ──────────────────────────────────────────────────
// Salary typically paid on 9th or 10th of month in Israel

function isPayday(date: Date): boolean {
  const d = date.getDate();
  return d >= 9 && d <= 10;
}

// ─── Israeli public holidays (fixed + approximate) ────────────────────────────
// Only including major demand-affecting holidays

const HOLIDAY_BOOSTS: Record<string, number> = {
  // Format: MM-DD
  "09-29": +15, // Rosh Hashana (approx)
  "09-30": +15,
  "10-08": -20, // Yom Kippur — near shutdown
  "10-13": +20, // Sukkot start
  "10-20": +20, // Simchat Torah
  "12-25": +10, // Hanukkah (approx)
  "03-13": +12, // Purim (approx)
  "04-23": +15, // Passover eve
  "04-24": -25, // Passover (partial shutdown)
  "05-12": +8,  // Lag BaOmer
  "05-22": +10, // Shavuot eve
};

function getHolidayDelta(date: Date): number {
  const key = [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return HOLIDAY_BOOSTS[key] ?? 0;
}

// ─── Peak hour boost by sector ────────────────────────────────────────────────

const PEAK_HOUR_BOOST: Record<string, (hour: number) => number> = {
  restaurant: (h) => {
    if (h >= 12 && h <= 14) return +15; // lunch
    if (h >= 19 && h <= 22) return +25; // dinner
    return 0;
  },
  fitness: (h) => {
    if (h >= 6 && h <= 9)   return +20; // morning
    if (h >= 17 && h <= 20) return +25; // after work
    return 0;
  },
  beauty: (h) => {
    if (h >= 10 && h <= 18) return +10; // business hours
    return -10;
  },
  local: (h) => {
    if (h >= 9 && h <= 18)  return +5;
    return -15;
  },
};

// ─── Local event demand boost ─────────────────────────────────────────────────

const EVENT_DEMAND_BOOST: Record<string, number> = {
  concert:   +20,
  sports:    +15,
  market:    +12,
  festival:  +25,
  roadwork:  -10,
  other:     +5,
};

function computeEventBoost(
  events: LocalEventRow[],
  forecastDate: string,
  forecastHour: number,
): number {
  let total = 0;
  for (const ev of events) {
    const evDate = new Date(ev.event_datetime);
    const evDay = evDate.toISOString().split("T")[0];
    if (evDay !== forecastDate) continue;

    const evHour = evDate.getHours();
    // Events boost demand in a ±3 hour window
    if (Math.abs(evHour - forecastHour) > 3) continue;

    const typeBoost = EVENT_DEMAND_BOOST[ev.event_type] ?? 0;
    // Scale by attendance and proximity (closer = bigger boost)
    const proximityFactor = Math.max(0.3, 1 - ev.distance_meters / 2000);
    const attendanceFactor = ev.expected_attendance ? Math.min(1.5, ev.expected_attendance / 2000) : 1;
    total += typeBoost * proximityFactor * attendanceFactor * ev.confidence_score;
  }
  return Math.round(total);
}

// ─── Fuse all factors into a refined demand index ─────────────────────────────
// Formula: base (weather) + event_boost + payday_boost + holiday_delta + peak_hour_boost
// Weather row is the "base" — we update it in place

async function refineForecastsForBusiness(
  biz: Business,
  weatherRows: WeatherForecastRow[],
  localEvents: LocalEventRow[],
): Promise<void> {
  const peakFn = PEAK_HOUR_BOOST[biz.sector] ?? PEAK_HOUR_BOOST.local;

  const updates = weatherRows.map((row) => {
    const date = new Date(`${row.forecast_date}T${String(row.hour_of_day).padStart(2, "0")}:00:00+02:00`);
    const paydayBoost  = isPayday(date) ? 8 : 0;
    const holidayDelta = getHolidayDelta(date);
    const peakBoost    = peakFn(row.hour_of_day);
    const eventBoost   = computeEventBoost(localEvents, row.forecast_date, row.hour_of_day);

    const totalDelta = row.demand_delta_pct + paydayBoost + holidayDelta + peakBoost + eventBoost;
    const clampedDelta = Math.max(-90, Math.min(60, totalDelta));

    const factors: Record<string, number> = {};
    if (paydayBoost  !== 0) factors.payday    = paydayBoost;
    if (holidayDelta !== 0) factors.holiday   = holidayDelta;
    if (peakBoost    !== 0) factors.peak_hour = peakBoost;
    if (eventBoost   !== 0) factors.local_event = eventBoost;

    return {
      business_id:          biz.id,
      forecast_date:        row.forecast_date,
      hour_of_day:          row.hour_of_day,
      demand_index:         100 + clampedDelta,
      demand_delta_pct:     clampedDelta,
      contributing_factors: {
        weather:      row.demand_delta_pct,
        ...factors,
      },
      weather_condition:    row.weather_condition,
      confidence_score:     Math.min(0.92, row.confidence_score + 0.05),
      source_url:           "internal://micro-demand-forecaster",
    };
  });

  if (updates.length === 0) return;

  // Upsert in batches of 50
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const { error } = await supabase.from("demand_forecasts").upsert(
      updates.slice(i, i + BATCH),
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

  for (const biz of (businesses ?? []) as Business[]) {
    try {
      // Load weather-driven forecasts for next 72h
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - 1);

      const { data: weatherRows, error: wErr } = await supabase
        .from("demand_forecasts")
        .select("forecast_date, hour_of_day, demand_delta_pct, weather_condition, confidence_score")
        .eq("business_id", biz.id)
        .gte("forecast_date", new Date().toISOString().split("T")[0])
        .order("forecast_date")
        .order("hour_of_day");

      if (wErr) throw wErr;
      if (!weatherRows || weatherRows.length === 0) {
        console.log(`[${AGENT_NAME}] No weather forecasts found for ${biz.id} — skipping`);
        continue;
      }

      // Load local events for the forecast window
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 3);

      const { data: localEvents } = await supabase
        .from("hyper_local_events")
        .select("event_datetime, event_type, expected_attendance, distance_meters, confidence_score")
        .eq("business_id", biz.id)
        .gte("event_datetime", new Date().toISOString())
        .lte("event_datetime", endDate.toISOString());

      await refineForecastsForBusiness(
        biz,
        weatherRows as WeatherForecastRow[],
        (localEvents ?? []) as LocalEventRow[],
      );

      successCount++;
      console.log(
        `[${AGENT_NAME}] ${biz.id}: refined ${weatherRows.length} hourly slots ` +
        `with ${(localEvents ?? []).length} local event(s)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed for ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Refine failed for ${biz.id}: ${msg}`);
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
  console.log(`[${AGENT_NAME}] Done. Refined: ${successCount}, Errors: ${errorCount}. Ping: ${now}`);
}

// deno-lint-ignore no-explicit-any
export async function runMicroDemandForecaster(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
