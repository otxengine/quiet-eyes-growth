// OTXEngine — Orchestration Layer: InsightFusionEngine
// Merges signals from all agents into ONE FusedInsight per business.
// Max 3 contributing signals — no information overload.
// Invariant: source_agents[] always lists the contributing agent names.
//
// Patent claim 1 steps 8–9:
//   step 8 — detectCorrelations(): identifies temporal, geographic, semantic correlations
//   step 9 — buildFusedInsight():  generates composite signal representation via fusion
// Patent claim 1 step 6 + Gap 3:
//   writeSignalObjects(): writes normalized signal objects to signal_objects table

import { callAnthropicAPI, parseAIJson } from "../lib/anthropic.ts";
import type {
  SupabaseClient,
  EnrichedContext,
  FusedInsight,
  InsightSignal,
  SignalCorrelation,
  SignalObject,
} from "./types.ts";

// ─── Weight functions per signal type ────────────────────────────────────────

function signalWeight(type: string, data: Record<string, unknown>): number {
  switch (type) {
    case "buyer_intent":    return Number(data.intent_score ?? 0.5);
    case "trend_spike":     return Math.min(1, Number(data.z_score ?? 1) / 5);
    case "local_event":     return Number(data.confidence_score ?? 0.5);
    case "competitor":      return 0.80; // always high weight — competitor moves matter
    case "cross_sector":    return Number(data.correlation_score ?? 0.5);
    case "demand_gap":      return Math.min(1, Math.abs(Number(data.demand_delta_pct ?? 0)) / 50);
    case "persona":         return Number(data.simulated_conversion_rate ?? 0.3);
    default:                return 0.4;
  }
}

// ─── Collect all signals from context into a flat ranked list ─────────────────

function collectSignals(context: EnrichedContext): InsightSignal[] {
  const signals: InsightSignal[] = [];

  for (const s of context.activeSignals) {
    signals.push({
      type:   "buyer_intent",
      weight: signalWeight("buyer_intent", s as unknown as Record<string, unknown>),
      data:   s as unknown as Record<string, unknown>,
    });
  }

  for (const t of context.activeTrends) {
    signals.push({
      type:   "trend_spike",
      weight: signalWeight("trend_spike", t as unknown as Record<string, unknown>),
      data:   t as unknown as Record<string, unknown>,
    });
  }

  for (const e of context.upcomingEvents) {
    signals.push({
      type:   "local_event",
      weight: signalWeight("local_event", e as unknown as Record<string, unknown>),
      data:   e as unknown as Record<string, unknown>,
    });
  }

  for (const c of context.competitorChanges) {
    signals.push({
      type:   "competitor",
      weight: signalWeight("competitor", c as unknown as Record<string, unknown>),
      data:   c as unknown as Record<string, unknown>,
    });
  }

  for (const x of context.crossSectorSignals) {
    signals.push({
      type:   "cross_sector",
      weight: signalWeight("cross_sector", x as unknown as Record<string, unknown>),
      data:   x as unknown as Record<string, unknown>,
    });
  }

  // Add demand gap as a signal if significant
  const worstDemand = context.demandForecast.reduce<number>(
    (min, f) => Math.min(min, f.demand_delta_pct),
    0,
  );
  if (worstDemand <= -15) {
    signals.push({
      type:   "demand_gap",
      weight: signalWeight("demand_gap", { demand_delta_pct: worstDemand }),
      data:   { demand_delta_pct: worstDemand, source: "WeatherDemandPredictor+MicroDemandForecaster" },
    });
  }

  // Persona as a signal if available
  if (context.personas.length > 0) {
    signals.push({
      type:   "persona",
      weight: signalWeight("persona", context.personas[0] as unknown as Record<string, unknown>),
      data:   context.personas[0] as unknown as Record<string, unknown>,
    });
  }

  return signals.sort((a, b) => b.weight - a.weight);
}

// ─── detectCorrelations — patent claim 1 step 8, Claim 4 ─────────────────────
// Identifies temporal, geographic, and semantic correlations among signal objects.
// Claim 4: "at least one of: temporal correlations, geographic correlations,
//           and semantic correlations."

export function detectCorrelations(signals: InsightSignal[]): SignalCorrelation[] {
  const correlations: SignalCorrelation[] = [];

  const SEMANTIC_PAIRS: Record<string, string[]> = {
    buyer_intent:  ["trend_spike", "local_event", "competitor"],
    trend_spike:   ["buyer_intent", "cross_sector", "viral_pattern"],
    local_event:   ["buyer_intent", "demand_gap"],
    competitor:    ["buyer_intent", "persona", "pricing"],
    cross_sector:  ["trend_spike", "demand_gap"],
    demand_gap:    ["local_event", "cross_sector"],
    persona:       ["competitor", "buyer_intent"],
  };

  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i];
      const b = signals[j];

      // Temporal correlation: both signals detected within 6 hours of each other
      const aTs = a.data.processed_at ?? a.data.detected_at_utc ?? a.data.computed_at;
      const bTs = b.data.processed_at ?? b.data.detected_at_utc ?? b.data.computed_at;
      if (aTs && bTs) {
        const diffHours = Math.abs(
          new Date(aTs as string).getTime() - new Date(bTs as string).getTime(),
        ) / 3_600_000;
        if (diffHours < 6) {
          correlations.push({
            type:         "temporal",
            strength:     Math.max(0, 1 - diffHours / 6),
            signal_types: [a.type, b.type],
            description:  `${a.type} and ${b.type} co-occurred within ${diffHours.toFixed(1)}h`,
          });
        }
      }

      // Geographic correlation: signals share same geo_city
      const aGeo = a.data.geo_city ?? a.data.geo;
      const bGeo = b.data.geo_city ?? b.data.geo;
      if (aGeo && bGeo && aGeo === bGeo) {
        correlations.push({
          type:         "geographic",
          strength:     1.0,
          signal_types: [a.type, b.type],
          description:  `Both signals from ${aGeo}`,
        });
      }

      // Semantic correlation: signal types belong to known related pairs
      const relatedTypes = SEMANTIC_PAIRS[a.type] ?? [];
      if (relatedTypes.includes(b.type)) {
        const strength = Math.min(a.weight, b.weight);
        correlations.push({
          type:         "semantic",
          strength,
          signal_types: [a.type, b.type],
          description:  `${a.type} semantically reinforces ${b.type}`,
        });
      }
    }
  }

  return correlations;
}

// ─── writeSignalObjects — patent claim 1 step 6, Gap 3 ───────────────────────
// Persists normalized signal objects to signal_objects table (common data schema).

async function writeSignalObjects(
  supabase: SupabaseClient,
  signals: InsightSignal[],
  businessId: string,
): Promise<void> {
  if (signals.length === 0) return;

  const AGENT_MAP: Record<string, string> = {
    buyer_intent:  "IntentClassification",
    trend_spike:   "SectorTrendRadar",
    local_event:   "HyperLocalContextAgent",
    competitor:    "CompetitorSnapshot",
    cross_sector:  "CrossSectorBridgeAgent",
    demand_gap:    "WeatherDemandPredictor",
    persona:       "SyntheticPersonaSimulator",
  };

  const rows: Omit<SignalObject, "id" | "created_at">[] = signals.map((s) => ({
    business_id:      businessId,
    signal_type:      s.type,
    source_agent:     AGENT_MAP[s.type] ?? "Unknown",
    source_record_id: String(s.data.id ?? ""),
    source_table:     String(s.data.source_table ?? ""),
    weight:           s.weight,
    payload:          s.data,
    contextual_attrs: {
      confidence_score: s.data.confidence_score ?? null,
      intent_score:     s.data.intent_score     ?? null,
      geo_match_score:  s.data.geo_match_score  ?? null,
      z_score:          s.data.z_score          ?? null,
      source_url:       s.data.source_url       ?? null,
    },
  }));

  const { error } = await supabase.from("signal_objects").insert(rows);
  if (error) {
    console.warn(`[InsightFusion] signal_objects write failed:`, error.message);
  }
}

// ─── Agent attribution ────────────────────────────────────────────────────────

function attributeAgents(signals: InsightSignal[]): string[] {
  const map: Record<string, string> = {
    buyer_intent:  "IntentClassification",
    trend_spike:   "SectorTrendRadar",
    local_event:   "HyperLocalContextAgent",
    competitor:    "CompetitorSnapshot",
    cross_sector:  "CrossSectorBridgeAgent",
    demand_gap:    "WeatherDemandPredictor",
    persona:       "SyntheticPersonaSimulator",
  };
  const agents = new Set(signals.map((s) => map[s.type]).filter(Boolean));
  // Always include ActionScoringService — it synthesizes everything
  agents.add("ActionScoringService");
  return Array.from(agents);
}

// ─── Urgency from top signal weights ─────────────────────────────────────────

function computeUrgency(signals: InsightSignal[]): "high" | "medium" | "low" {
  if (signals.length === 0) return "low";
  const topWeight = signals[0].weight;
  if (topWeight >= 0.75) return "high";
  if (topWeight >= 0.50) return "medium";
  return "low";
}

// ─── buildFusedInsight — MAIN EXPORT ─────────────────────────────────────────
// Invariant: max 3 contributing signals in output.
// Patent claim 1 steps 8–9: detects correlations, then fuses into composite representation.
// Optional supabase param: when provided, writes signal objects to signal_objects table (Gap 3).

export async function buildFusedInsight(
  context: EnrichedContext,
  supabase?: SupabaseClient,
): Promise<FusedInsight> {
  const allSignals = collectSignals(context);
  const top3 = allSignals.slice(0, 3); // INVARIANT: max 3

  // Patent claim 1 step 8: identify correlations among signal objects
  const correlations = detectCorrelations(allSignals);
  const topCorrelation = correlations.sort((a, b) => b.strength - a.strength)[0];

  // Patent claim 1 step 6 / Gap 3: write normalized signal objects to DB
  if (supabase && top3.length > 0) {
    writeSignalObjects(supabase, top3, context.business.id).catch(() => {/* non-critical */});
  }

  const urgency = computeUrgency(top3);
  const sourceAgents = attributeAgents(top3);
  const { business, personas, demandForecast } = context;

  // Build concise signal summary including detected correlations
  const signalSummary = top3
    .map((s, i) => {
      const preview = JSON.stringify(s.data).slice(0, 250);
      return `${i + 1}. [${s.type} | weight=${s.weight.toFixed(2)}] ${preview}`;
    })
    .join("\n");

  const correlationNote = topCorrelation
    ? `קורלציה עיקרית: ${topCorrelation.type} בין ${topCorrelation.signal_types.join(" + ")} (חוזק: ${topCorrelation.strength.toFixed(2)})`
    : "";

  const forecastDelta = demandForecast[0]?.demand_delta_pct ?? 0;
  const topPersona = personas[0]?.persona_name ?? "לא ידוע";

  const fusionPrompt = `
עסק: ${business.sector} ב${business.geo_city}
סנטימנט כולל: ${urgency === "high" ? "דחוף" : urgency === "medium" ? "בינוני" : "רגיל"}

3 האיתותות הכי חשובות כעת:
${signalSummary}
${correlationNote ? `\n${correlationNote}\n` : ""}
תחזית ביקוש 24 שעות: ${forecastDelta > 0 ? "+" : ""}${forecastDelta}%
פרסונה מובילה: ${topPersona}

ייצר תובנה מאוחדת. ענה JSON בלבד:
{
  "headline": "כותרת אחת, עד 8 מילים",
  "urgency": "${urgency}",
  "one_sentence": "מה קורה עכשיו, משפט אחד",
  "impact_number": "מספר אחד עם הקשר (לדוגמה: +18% ביקוש, -23% עסקאות)",
  "action_label": "פועל + יעד, עד 5 מילים",
  "action_time_minutes": 15,
  "source_agents": ${JSON.stringify(sourceAgents)}
}
`;

  try {
    const raw = await callAnthropicAPI(fusionPrompt, 600);
    const parsed = parseAIJson<Omit<FusedInsight, "contributing_signals" | "computed_at">>(raw);

    return {
      headline:             (parsed.headline ?? "").slice(0, 100),
      urgency:              (["high", "medium", "low"].includes(parsed.urgency as string) ? parsed.urgency : urgency) as "high" | "medium" | "low",
      one_sentence:         (parsed.one_sentence ?? "").slice(0, 300),
      impact_number:        (parsed.impact_number ?? "").slice(0, 50),
      action_label:         (parsed.action_label ?? "").slice(0, 60),
      action_time_minutes:  Math.max(1, Math.min(120, Number(parsed.action_time_minutes ?? 15))),
      source_agents:        (parsed.source_agents ?? sourceAgents),
      contributing_signals: top3,
      computed_at:          new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[InsightFusion] AI failed — using fallback insight:`, msg);

    // Fallback: deterministic insight from top signal
    const top = top3[0];
    return {
      headline:             `עדכון חשוב: ${business.sector} ${business.geo_city}`,
      urgency,
      one_sentence:         top
        ? `זוהה ${top.type === "trend_spike" ? "ספייק בטרנד" : top.type === "competitor" ? "שינוי מתחרה" : "אות חדש"} בשוק`
        : "ממתין לנתונים נוספים",
      impact_number:        forecastDelta !== 0 ? `${forecastDelta > 0 ? "+" : ""}${forecastDelta}% ביקוש` : "—",
      action_label:         "בדוק עכשיו",
      action_time_minutes:  10,
      source_agents:        sourceAgents,
      contributing_signals: top3,
      computed_at:          new Date().toISOString(),
    };
  }
}
