// OTXEngine — Agent 11: ResourceArbitrageAgent
// Schedule: every 6 hours (after micro_demand_forecaster)
// Output: resource_arbitrage_actions
// Triggers: demand gap ≤ -15%, weather-driven, competitor gap, low inventory signal

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "ResourceArbitrageAgent";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  sector: string;
  geo_city: string;
  price_tier: string | null;
}

interface DemandForecastRow {
  forecast_date: string;
  hour_of_day: number;
  demand_delta_pct: number;
  weather_condition: string;
  contributing_factors: Record<string, number>;
}

interface AiAction {
  trigger_description: string;
  recommended_action: string;
  action_type: "promotion" | "coupon" | "menu_change" | "staffing" | "delivery_push";
  target_segment: string;
  expected_uplift_pct: number;
}

// ─── Sector-specific action type preferences ──────────────────────────────────

const SECTOR_ACTION_PREFS: Record<string, string[]> = {
  restaurant: ["delivery_push", "promotion", "coupon", "menu_change"],
  fitness:    ["promotion", "coupon", "staffing"],
  beauty:     ["promotion", "coupon", "staffing"],
  local:      ["promotion", "coupon", "delivery_push"],
};

// ─── Detect demand gaps from forecast rows ────────────────────────────────────

interface GapWindow {
  date: string;
  startHour: number;
  endHour: number;
  avgDelta: number;
  worstDelta: number;
  condition: string;
  factors: Record<string, number>;
}

function detectGapWindows(forecasts: DemandForecastRow[]): GapWindow[] {
  const gaps: GapWindow[] = [];
  let windowStart: DemandForecastRow | null = null;
  let windowHours: DemandForecastRow[] = [];

  for (const row of forecasts) {
    if (row.demand_delta_pct <= -15) {
      if (!windowStart) windowStart = row;
      windowHours.push(row);
    } else {
      if (windowStart && windowHours.length > 0) {
        const avgDelta = windowHours.reduce((s, r) => s + r.demand_delta_pct, 0) / windowHours.length;
        gaps.push({
          date:       windowStart.forecast_date,
          startHour:  windowStart.hour_of_day,
          endHour:    windowHours[windowHours.length - 1].hour_of_day,
          avgDelta:   Math.round(avgDelta),
          worstDelta: Math.min(...windowHours.map((r) => r.demand_delta_pct)),
          condition:  windowStart.weather_condition,
          factors:    windowStart.contributing_factors,
        });
        windowStart = null;
        windowHours = [];
      }
    }
  }

  // Flush open window
  if (windowStart && windowHours.length > 0) {
    const avgDelta = windowHours.reduce((s, r) => s + r.demand_delta_pct, 0) / windowHours.length;
    gaps.push({
      date:       windowStart.forecast_date,
      startHour:  windowStart.hour_of_day,
      endHour:    windowHours[windowHours.length - 1].hour_of_day,
      avgDelta:   Math.round(avgDelta),
      worstDelta: Math.min(...windowHours.map((r) => r.demand_delta_pct)),
      condition:  windowStart.weather_condition,
      factors:    windowStart.contributing_factors,
    });
  }

  return gaps;
}

// ─── AI-generated counter-action ──────────────────────────────────────────────

async function generateAction(biz: Business, gap: GapWindow): Promise<AiAction> {
  const actionPrefs = (SECTOR_ACTION_PREFS[biz.sector] ?? SECTOR_ACTION_PREFS.local).join(", ");
  const factorsList = Object.entries(gap.factors)
    .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}%`)
    .join(", ");

  const prompt = `
עסק: ${biz.name}
סקטור: ${biz.sector} | עיר: ${biz.geo_city} | מחיר: ${biz.price_tier ?? "mid"}
חלון זמן: ${gap.date} שעות ${gap.startHour}-${gap.endHour}
ירידת ביקוש חזויה: ${gap.avgDelta}% (גרוע: ${gap.worstDelta}%)
מזג אוויר: ${gap.condition}
גורמים: ${factorsList}
סוגי פעולה מומלצים: ${actionPrefs}

הצע פעולה אחת קונקרטית להחזיר ביקוש בחלון זה.
ענה JSON בלבד:
{
  "trigger_description": "תיאור קצר של הירידה",
  "recommended_action": "פעולה ספציפית (עד 3 משפטים)",
  "action_type": "delivery_push|promotion|coupon|menu_change|staffing",
  "target_segment": "פלח לקוחות יעד",
  "expected_uplift_pct": 10
}
`;

  const raw = await callAnthropicAPI(prompt, 512);
  return parseAIJson<AiAction>(raw);
}

// ─── Validate AI action type ──────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set(["promotion", "coupon", "menu_change", "staffing", "delivery_push"]);

function sanitizeAction(ai: AiAction, sector: string): AiAction {
  const prefs = SECTOR_ACTION_PREFS[sector] ?? SECTOR_ACTION_PREFS.local;
  return {
    ...ai,
    action_type: VALID_ACTION_TYPES.has(ai.action_type) ? ai.action_type : prefs[0] as AiAction["action_type"],
    expected_uplift_pct: Math.max(1, Math.min(50, ai.expected_uplift_pct ?? 10)),
    target_segment: ai.target_segment?.slice(0, 200) ?? "general",
    recommended_action: ai.recommended_action?.slice(0, 1000) ?? "",
    trigger_description: ai.trigger_description?.slice(0, 500) ?? "",
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  let totalActions = 0;
  let errorCount = 0;

  for (const biz of (businesses ?? []) as Business[]) {
    try {
      // Load 72h demand forecasts with gaps
      const { data: forecasts, error: fErr } = await supabase
        .from("demand_forecasts")
        .select("forecast_date, hour_of_day, demand_delta_pct, weather_condition, contributing_factors")
        .eq("business_id", biz.id)
        .gte("forecast_date", new Date().toISOString().split("T")[0])
        .lte("demand_delta_pct", -15)
        .order("forecast_date")
        .order("hour_of_day");

      if (fErr) throw fErr;
      if (!forecasts || forecasts.length === 0) continue;

      const gaps = detectGapWindows(forecasts as DemandForecastRow[]);
      if (gaps.length === 0) continue;

      // Check for already-generated actions in the same window (avoid duplicates)
      const { data: existingActions } = await supabase
        .from("resource_arbitrage_actions")
        .select("valid_from")
        .eq("business_id", biz.id)
        .gte("valid_from", new Date().toISOString())
        .eq("executed", false);

      const existingDates = new Set(
        ((existingActions ?? []) as { valid_from: string }[])
          .map((r) => r.valid_from.split("T")[0]),
      );

      for (const gap of gaps) {
        if (existingDates.has(gap.date)) continue; // already has action for this day

        let aiAction: AiAction;
        try {
          aiAction = await generateAction(biz, gap);
          aiAction = sanitizeAction(aiAction, biz.sector);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[${AGENT_NAME}] AI action failed for ${biz.name} on ${gap.date}: ${msg}`);
          // Fallback action
          const prefs = SECTOR_ACTION_PREFS[biz.sector] ?? SECTOR_ACTION_PREFS.local;
          aiAction = {
            trigger_description: `ירידת ביקוש ${gap.avgDelta}% בגלל ${gap.condition}`,
            recommended_action:  `הפעל מבצע לחיזוק ביקוש בשעות ${gap.startHour}-${gap.endHour}`,
            action_type:         prefs[0] as AiAction["action_type"],
            target_segment:      "כל הלקוחות",
            expected_uplift_pct: 10,
          };
        }

        const validFrom = new Date(`${gap.date}T${String(gap.startHour).padStart(2, "0")}:00:00+02:00`);
        const validUntil = new Date(`${gap.date}T${String(gap.endHour + 1).padStart(2, "0")}:00:00+02:00`);

        const { error: insErr } = await supabase.from("resource_arbitrage_actions").insert({
          business_id:         biz.id,
          trigger_type:        "low_demand",
          trigger_description: aiAction.trigger_description,
          recommended_action:  aiAction.recommended_action,
          action_type:         aiAction.action_type,
          target_segment:      aiAction.target_segment,
          expected_uplift_pct: aiAction.expected_uplift_pct,
          valid_from:          validFrom.toISOString(),
          valid_until:         validUntil.toISOString(),
          executed:            false,
          source_url:          "internal://resource-arbitrage-agent",
          detected_at_utc:     new Date().toISOString(),
          confidence_score:    0.75,
        });

        if (insErr) {
          console.error(`[${AGENT_NAME}] Insert failed for ${biz.id}:`, insErr.message);
          errorCount++;
        } else {
          totalActions++;
          console.log(
            `[${AGENT_NAME}] ✓ ${biz.name} | ${gap.date} ${gap.startHour}-${gap.endHour}h | ` +
            `${aiAction.action_type} | +${aiAction.expected_uplift_pct}%`,
          );

          // Publish to bus — triggers ActionScoringService
          const { data: inserted } = await supabase
            .from("resource_arbitrage_actions")
            .select("id")
            .eq("business_id", biz.id)
            .order("detected_at_utc", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (inserted?.id) {
            await publishToBus(supabase, {
              business_id:    biz.id,
              sourceAgent:    AGENT_NAME,
              sourceRecordId: inserted.id as string,
              sourceTable:    "resource_arbitrage_actions",
              event_type:     "arbitrage_action_ready",
              payload: {
                action_type:         aiAction.action_type,
                expected_uplift_pct: aiAction.expected_uplift_pct,
                demand_delta:        gap.avgDelta,
              },
            }).catch(() => {/* non-critical */});
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed for ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Arbitrage failed for ${biz.name}: ${msg}`);
      errorCount++;
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} errors` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Actions generated: ${totalActions}, Errors: ${errorCount}. Ping: ${now}`);
}

// deno-lint-ignore no-explicit-any
export async function runResourceArbitrageAgent(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
