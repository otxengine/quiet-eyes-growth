// OTXEngine — Orchestration Layer: BusPublisher
// Every agent calls publishToBus() after producing output.
// No agent calls another agent directly — the bus is the only inter-agent channel.

import type { SupabaseClient, BusEvent, BusEventType, AgentRoute } from "./types.ts";

// ─── EVENT ROUTING MAP ────────────────────────────────────────────────────────
// Defines: for each event_type, which agents are triggered, in what priority order,
// and under which condition.

export const EVENT_ROUTING: Record<BusEventType, AgentRoute[]> = {
  // Layer 1 → Layer 2
  "new_signal": [
    { agent: "IntentClassification",    priority: 1, condition: "always" },
    { agent: "SectorTrendRadar",        priority: 2, condition: "always" },
    { agent: "HyperLocalContextAgent",  priority: 3, condition: "has_geo_coordinates" },
    { agent: "NegotiationPricingCoach", priority: 4, condition: "intent_score > 0.65" }, // Layer 7
  ],

  // Layer 2 → Layer 3 + Layer 5
  "signal_qualified": [
    { agent: "ActionScoringService",      priority: 1, condition: "intent_score > 0.65" },
    { agent: "SyntheticPersonaSimulator", priority: 3, condition: "always" },
    { agent: "ResourceArbitrageAgent",    priority: 4, condition: "demand_delta < -15" },
  ],

  // Layer 2 → Layer 4 + Layer 6 + Layer 7
  "trend_spike": [
    { agent: "InfluenceIntegrityAuditor", priority: 1, condition: "always" },        // Layer 7: validate first
    { agent: "ViralCatalyst",             priority: 2, condition: "z_score > 2.5" }, // Layer 7: content opportunity
    { agent: "ActionScoringService",      priority: 3, condition: "z_score > 2.0" },
    { agent: "CrossSectorBridgeAgent",    priority: 4, condition: "always" },
    { agent: "ResourceArbitrageAgent",    priority: 5, condition: "always" },
  ],

  // Layer 5 (HyperLocal) → Layer 5 (WeatherPredictor) + Layer 4
  "local_event_detected": [
    { agent: "WeatherDemandPredictor",  priority: 1, condition: "always" },
    { agent: "MicroDemandForecaster",   priority: 2, condition: "always" },
    { agent: "ActionScoringService",    priority: 1, condition: "attendance > 500" },
    { agent: "ResourceArbitrageAgent",  priority: 2, condition: "attendance > 200" },
  ],

  // Layer 5 (WeatherPredictor) → Layer 5 (Arbitrage) + Layer 5 (MicroDemand)
  "demand_gap_forecast": [
    { agent: "ResourceArbitrageAgent",  priority: 1, condition: "demand_delta < -15" },
    { agent: "MicroDemandForecaster",   priority: 2, condition: "always" },
    { agent: "ActionScoringService",    priority: 1, condition: "demand_delta < -20" },
  ],

  // Layer 1 (Competitor) → Layer 4 + Layer 6
  "competitor_change": [
    { agent: "ActionScoringService",       priority: 1, condition: "always" },
    { agent: "CrossSectorBridgeAgent",     priority: 3, condition: "change_type = price" },
    { agent: "SyntheticPersonaSimulator",  priority: 4, condition: "change_type = price" },
  ],

  // Layer 6 (Persona) → Layer 4 + Layer 3
  "persona_updated": [
    { agent: "ActionScoringService", priority: 2, condition: "always" },
    { agent: "MarketMemoryEngine",   priority: 5, condition: "personas_count >= 3" },
  ],

  // Layer 6 (CrossSector) → Layer 4 + Layer 10
  "cross_sector_opportunity": [
    { agent: "ActionScoringService",   priority: 2, condition: "correlation_score > 0.65" },
    { agent: "HyperLocalContextAgent", priority: 3, condition: "always" },
  ],

  // Layer 5 (Arbitrage) → Layer 4
  "arbitrage_action_ready": [
    { agent: "ActionScoringService", priority: 1, condition: "always" },
  ],

  // Layer 4 → Layer 3
  "action_scored": [
    { agent: "MarketMemoryEngine", priority: 5, condition: "action_score > 0.60" },
  ],

  // Layer 3 → closing the learning loop
  "memory_updated": [
    { agent: "ActionScoringService",      priority: 3, condition: "always" },
    { agent: "SyntheticPersonaSimulator", priority: 5, condition: "always" },
    { agent: "ResourceArbitrageAgent",    priority: 5, condition: "always" },
  ],

  // MetaConfigurator → all downstream
  "config_updated": [
    { agent: "SignalCollector",        priority: 1, condition: "always" },
    { agent: "IntentClassification",   priority: 1, condition: "always" },
    { agent: "SectorTrendRadar",       priority: 1, condition: "always" },
    { agent: "HyperLocalContextAgent", priority: 2, condition: "always" },
    { agent: "CompetitorSnapshot",     priority: 2, condition: "always" },
  ],

  // ── Layer 7 event routing ─────────────────────────────────────────────────

  // ViralCatalyst → CampaignAutoPilot + ActionScoringService
  "viral_pattern_detected": [
    { agent: "CampaignAutoPilot",    priority: 1, condition: "virality_score > 0.70" },
    { agent: "ActionScoringService", priority: 2, condition: "always" },
  ],

  // InfluenceIntegrityAuditor — trend verified organic
  "trend_verified": [
    { agent: "ActionScoringService", priority: 2, condition: "always" },
  ],

  // InfluenceIntegrityAuditor — trend is manipulated; suppresses action on this trend
  "trend_manipulated": [
    { agent: "ActionScoringService", priority: 1, condition: "always" },
  ],

  // DeepContextVisionAgent → scouts + ActionScoring on unmet demand
  "visual_insight_detected": [
    { agent: "ServiceExpansionScout", priority: 2, condition: "always" },
    { agent: "ActionScoringService",  priority: 3, condition: "always" },
  ],

  // RetentionSentinel → NegotiationPricingCoach (critical) + CampaignAutoPilot (high)
  "churn_risk_detected": [
    { agent: "NegotiationPricingCoach", priority: 3, condition: "risk_level = critical" },
    { agent: "CampaignAutoPilot",       priority: 4, condition: "risk_level = high" },
  ],

  // NegotiationPricingCoach — no auto-trigger; user reviews in dashboard
  "pricing_recommendation_ready": [],

  // CampaignAutoPilot — auto_publish always FALSE in MVP; no further routing
  "campaign_draft_ready": [],

  // ServiceExpansionScout → SyntheticPersonaSimulator + ActionScoringService
  "expansion_opportunity_detected": [
    { agent: "SyntheticPersonaSimulator", priority: 3, condition: "always" },
    { agent: "ActionScoringService",      priority: 2, condition: "confidence_score > 0.70" },
  ],

  // ReputationWarRoom — priority 1 for critical, 2 for others
  "reputation_incident_detected": [
    { agent: "ActionScoringService", priority: 1, condition: "severity = critical" },
  ],
};

// ─── Condition evaluator ──────────────────────────────────────────────────────
// Evaluates simple expressions against the event payload.
// Supported: "always", "field > number", "field < number", "field = value",
//            "field >= number"

export function evaluateCondition(
  condition: string,
  payload: Record<string, unknown>,
): boolean {
  if (condition === "always") return true;

  // "has_geo_coordinates" — custom check
  if (condition === "has_geo_coordinates") {
    return payload.lat != null && payload.lon != null;
  }

  // "field > number" or "field < number" or "field >= number"
  const numMatch = condition.match(/^(\w+)\s*(>=|<=|>|<)\s*([\d.]+)$/);
  if (numMatch) {
    const [, field, op, rhs] = numMatch;
    const val = Number(payload[field] ?? 0);
    const threshold = parseFloat(rhs);
    if (op === ">")  return val > threshold;
    if (op === "<")  return val < threshold;
    if (op === ">=") return val >= threshold;
    if (op === "<=") return val <= threshold;
  }

  // "field = value"
  const eqMatch = condition.match(/^(\w+)\s*=\s*(.+)$/);
  if (eqMatch) {
    const [, field, rhs] = eqMatch;
    return String(payload[field] ?? "") === rhs.trim();
  }

  // Unknown condition — default allow
  console.warn(`[BusPublisher] Unknown condition: "${condition}" — defaulting to true`);
  return true;
}

// ─── TTL per event type ───────────────────────────────────────────────────────

const EVENT_TTL_MS: Record<BusEventType, number> = {
  // Layer 1–6
  "new_signal":               2  * 60 * 60 * 1000,
  "signal_qualified":         4  * 60 * 60 * 1000,
  "trend_spike":              6  * 60 * 60 * 1000,
  "local_event_detected":     24 * 60 * 60 * 1000,
  "demand_gap_forecast":      48 * 60 * 60 * 1000,
  "competitor_change":        24 * 60 * 60 * 1000,
  "persona_updated":          12 * 60 * 60 * 1000,
  "cross_sector_opportunity": 72 * 60 * 60 * 1000,
  "arbitrage_action_ready":   4  * 60 * 60 * 1000,
  "action_scored":            4  * 60 * 60 * 1000,
  "memory_updated":           7  * 24 * 60 * 60 * 1000,
  "config_updated":           30 * 24 * 60 * 60 * 1000,
  // Layer 7
  "viral_pattern_detected":       4  * 60 * 60 * 1000,  // viral windows close fast
  "trend_verified":               6  * 60 * 60 * 1000,
  "trend_manipulated":            12 * 60 * 60 * 1000,
  "visual_insight_detected":      24 * 60 * 60 * 1000,
  "churn_risk_detected":          48 * 60 * 60 * 1000,
  "pricing_recommendation_ready": 6  * 60 * 60 * 1000,  // pricing has valid_until
  "campaign_draft_ready":         24 * 60 * 60 * 1000,
  "expansion_opportunity_detected": 7 * 24 * 60 * 60 * 1000,
  "reputation_incident_detected": 30 * 60 * 1000,       // 30 min — crises move fast
};

// ─── Priority computation ─────────────────────────────────────────────────────

function computePriority(event: BusEvent): number {
  const { event_type, payload } = event;

  // Layer 7 — reputation is always highest priority
  if (event_type === "reputation_incident_detected" && payload.severity === "critical") return 1;
  if (event_type === "reputation_incident_detected")                                    return 2;
  if (event_type === "trend_manipulated")                                               return 1;
  if (event_type === "viral_pattern_detected" && Number(payload.virality_score ?? 0) > 0.85) return 2;
  if (event_type === "churn_risk_detected"    && payload.risk_level === "critical")     return 2;

  // Layer 1–6 (existing)
  if (event_type === "trend_spike" && Number(payload.z_score ?? 0) > 3.0)               return 1;
  if (event_type === "local_event_detected" && Number(payload.attendance ?? 0) > 1000)  return 1;
  if (event_type === "demand_gap_forecast"  && Number(payload.demand_delta ?? 0) < -30) return 1;
  if (event_type === "competitor_change")                                                return 2;
  if (event_type === "signal_qualified")                                                 return 3;
  if (event_type === "arbitrage_action_ready")                                           return 3;
  if (event_type === "action_scored")                                                    return 4;
  return 5;
}

// ─── publishToBus ─────────────────────────────────────────────────────────────
// Called by every agent after writing its output.
// Only publishes if ≥1 consumer route passes the condition check.

export async function publishToBus(
  supabase: SupabaseClient,
  event: BusEvent,
): Promise<void> {
  const routes = EVENT_ROUTING[event.event_type] ?? [];

  const targets = routes
    .filter((r) => evaluateCondition(r.condition, event.payload))
    .map((r) => r.agent);

  if (targets.length === 0) return; // nothing listens → skip write

  const expiresAt = new Date(Date.now() + (EVENT_TTL_MS[event.event_type] ?? 4 * 60 * 60 * 1000));

  const { error } = await supabase.from("agent_data_bus").insert({
    business_id:      event.business_id,
    source_agent:     event.sourceAgent,
    source_record_id: event.sourceRecordId,
    source_table:     event.sourceTable,
    event_type:       event.event_type,
    payload:          event.payload,
    priority:         computePriority(event),
    target_agents:    targets,
    consumed_by:      [],
    expires_at:       expiresAt.toISOString(),
    processed:        false,
  });

  if (error) {
    console.error(`[BusPublisher] Failed to publish ${event.event_type} for ${event.business_id}:`, error.message);
  } else {
    console.log(`[BusPublisher] ✓ ${event.sourceAgent} → ${event.event_type} → [${targets.join(", ")}]`);
  }
}
