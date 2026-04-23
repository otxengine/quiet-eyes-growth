// OTXEngine — Agent 19: NegotiationPricingCoach
// Trigger: bus event 'new_signal' with high intent (intent_score > 0.65) OR 'churn_risk_detected' (critical)
// Output: pricing_recommendations → publishes 'pricing_recommendation_ready' to bus
// Mission: Dynamic pricing recommendations based on real-time market supply/demand + lead profile.
// Invariant: every recommendation has a valid_until timestamp — pricing windows close.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext, ClassifiedSignal } from "./orchestration/types.ts";

const AGENT_NAME = "NegotiationPricingCoach";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface MarketSupply {
  supply:               "scarce" | "balanced" | "flooded";
  competitor_prices:    number[];
  avg_competitor_price: number;
  demand_index:         number;
  urgency_signals:      number;
}

interface LeadProfile {
  urgency_level:     "low" | "medium" | "high" | "critical";
  price_sensitivity: "low" | "medium" | "high";
  decision_timeline: "today" | "this_week" | "flexible";
  budget_signals:    string[];
}

interface PricingTactic {
  recommended_price: number;
  tactic:            "premium" | "standard" | "discount" | "bundle";
  opening_line:      string;
  anchor_price:      number;
  close_technique:   "urgency" | "social_proof" | "scarcity" | "value";
  confidence_pct:    number;
  valid_hours:       number;
}

// ─── Market supply assessment ─────────────────────────────────────────────────

async function assessMarketSupply(
  sector: string,
  geoCity: string,
): Promise<MarketSupply> {
  // Query competitor_changes for recent pricing signals
  const { data: changes } = await supabase
    .from("competitor_changes")
    .select("change_type, change_summary, confidence_score")
    .eq("business_id", sector) // sector used as a proxy filter key in join; fallback below
    .order("detected_at_utc", { ascending: false })
    .limit(20)
    .then(async (res) => {
      // competitor_changes is scoped by business_id, not geo_city — fetch broadly
      if (res.data && res.data.length > 0) return res;
      return supabase
        .from("competitor_changes")
        .select("change_type, change_summary, confidence_score")
        .order("detected_at_utc", { ascending: false })
        .limit(20);
    });

  const prices: number[] = [];
  let urgencyCount = 0;

  for (const change of (changes ?? [])) {
    const c = change as { change_type?: string; change_summary?: string };
    // Extract price numbers from change_summary text (e.g. "מחיר עלה ל-₪450")
    const priceMatches = (c.change_summary ?? "").match(/[\d,]+/g) ?? [];
    for (const m of priceMatches) {
      const p = parseInt(m.replace(",", ""), 10);
      if (p > 50 && p < 10000) prices.push(p); // plausible ILS price range
    }
    if (c.change_type === "price") urgencyCount++;
  }

  void geoCity; // used contextually in prompt

  const avgPrice = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : 450; // fallback median for Israeli SMBs

  return {
    supply:               urgencyCount > 3 ? "scarce" : prices.length > 10 ? "flooded" : "balanced",
    competitor_prices:    prices.slice(0, 5),
    avg_competitor_price: avgPrice,
    demand_index:         50 + urgencyCount * 5,
    urgency_signals:      urgencyCount,
  };
}

function computePricingModifier(
  market: MarketSupply,
  lead: LeadProfile,
): number {
  let modifier = 0;

  if (market.supply === "scarce")  modifier += 15;
  if (market.supply === "flooded") modifier -= 10;

  if (lead.urgency_level === "critical") modifier += 10;
  if (lead.urgency_level === "high")     modifier += 5;

  if (lead.price_sensitivity === "high") modifier -= 10;
  if (lead.price_sensitivity === "low")  modifier += 5;

  if (lead.decision_timeline === "today") modifier += 5;

  return Math.max(-25, Math.min(35, modifier));
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runNegotiationPricingCoach(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  // Use the most recent high-intent active signal from context
  const leadSignal: ClassifiedSignal | null =
    context.activeSignals.find((s) => s.intent_score > 0.65) ?? context.activeSignals[0] ?? null;

  if (!leadSignal) {
    console.log(`[${AGENT_NAME}] No qualifying lead signal — skipping`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const marketSupply = await assessMarketSupply(
    context.business.sector,
    context.business.geo_city,
  );

  // Analyze lead intent
  const leadAnalysisPrompt = `
ניתח את הסיגנל הזה כליד פוטנציאלי:
"intent_score: ${leadSignal.intent_score}, source: ${leadSignal.source_url}"

JSON:
{
  "urgency_level": "medium",
  "price_sensitivity": "medium",
  "decision_timeline": "this_week",
  "budget_signals": []
}
  `.trim();

  let leadProfile: LeadProfile = {
    urgency_level: "medium",
    price_sensitivity: "medium",
    decision_timeline: "this_week",
    budget_signals: [],
  };
  try {
    const raw = await callAnthropicAPI(leadAnalysisPrompt, 256);
    leadProfile = parseAIJson<LeadProfile>(raw);
  } catch {
    // use defaults
  }

  const pricingModifier = computePricingModifier(marketSupply, leadProfile);

  const tacticPrompt = `
שוק: ${marketSupply.supply} | ביקוש: ${marketSupply.demand_index}/100
ליד: דחיפות ${leadProfile.urgency_level} | רגישות מחיר: ${leadProfile.price_sensitivity}
מחיר ממוצע מתחרים: ₪${marketSupply.avg_competitor_price.toFixed(0)}
מודיפייר מחושב: ${pricingModifier > 0 ? "+" : ""}${pricingModifier}%
עסק: ${context.business.sector} ב${context.business.geo_city}

ייצר המלצת תמחור. JSON:
{
  "recommended_price": 500,
  "tactic": "standard",
  "opening_line": "משפט פתיחה לשיחת מכירה — עד 15 מילה",
  "anchor_price": 600,
  "close_technique": "value",
  "confidence_pct": 75,
  "valid_hours": 6
}
  `.trim();

  let recommendation: PricingTactic | null = null;
  try {
    const raw = await callAnthropicAPI(tacticPrompt, 512);
    recommendation = parseAIJson<PricingTactic>(raw);
  } catch (e) {
    console.error(`[${AGENT_NAME}] Tactic generation failed:`, e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, String(e));
    return;
  }

  const validUntil = new Date(
    Date.now() + (recommendation.valid_hours ?? 6) * 3600000,
  ).toISOString();

  const { data: row, error } = await supabase
    .from("pricing_recommendations")
    .insert({
      business_id:                context.business.id,
      lead_context:               `intent_score=${leadSignal.intent_score}`,
      market_supply:              marketSupply.supply,
      competitor_avg_price:       marketSupply.avg_competitor_price,
      recommended_price_modifier: pricingModifier,
      recommended_tactic:         recommendation.tactic,
      tactic_reason:              recommendation.opening_line,
      confidence_pct:             recommendation.confidence_pct,
      valid_until:                validUntil,
      source_url:                 leadSignal.source_url,
      confidence_score:           recommendation.confidence_pct / 100,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, error.message);
    return;
  }

  await publishToBus(supabase, {
    business_id:    context.business.id,
    sourceAgent:    AGENT_NAME,
    sourceRecordId: row?.id ?? "",
    sourceTable:    "pricing_recommendations",
    event_type:     "pricing_recommendation_ready",
    payload: {
      tactic:             recommendation.tactic,
      modifier_pct:       pricingModifier,
      confidence_pct:     recommendation.confidence_pct,
      valid_until:        validUntil,
    },
  });

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — tactic: ${recommendation.tactic}, modifier: ${pricingModifier}%`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runNegotiationPricingCoach(supabase, ctx);
  }
}
