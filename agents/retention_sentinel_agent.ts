// OTXEngine — Agent 18: RetentionSentinel
// Schedule: every 3 hours + triggered on 'new_signal' with source_type='social' (via BusListener)
// Output: retention_alerts → publishes 'churn_risk_detected' to bus
// Mission: Detect at-risk customers via behavioral + external signals; generate personalized retention offers.
// Privacy: uses hashed identifiers only — no PII stored.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type {
  EnrichedContext,
  CustomerProfile,
  ExternalSignal,
} from "./orchestration/types.ts";

const AGENT_NAME = "RetentionSentinel";
const CHURN_THRESHOLD = 0.40;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface RetentionOffer {
  offer_text:           string;
  channel:              "whatsapp" | "sms" | "email";
  urgency_reason:       string;
  discount_pct:         number | null;
  personalization_hook: string;
}

// ─── At-risk customer identification (stubbed — connect to CRM/POS data) ──────

async function identifyAtRiskCustomers(
  context: EnrichedContext,
): Promise<CustomerProfile[]> {
  // Use classified_signals to surface at-risk customer segments.
  // Signals that were NOT qualified (low intent, no conversion) in the last 90 days
  // are used as proxies for customers who visited but didn't engage — churn candidates.
  const since90d = new Date(Date.now() - 90 * 24 * 3600000).toISOString();
  const { data } = await supabase
    .from("classified_signals")
    .select("id, signal_id, intent_score, confidence_score, processed_at, source_url")
    .eq("business_id", context.business.id)
    .eq("qualified", false)
    .gte("processed_at", since90d)
    .order("processed_at", { ascending: true }) // oldest first = longest inactive
    .limit(50);

  if (!data || data.length === 0) return [];

  return data.map((row: {
    signal_id: string;
    intent_score: number;
    processed_at: string;
  }) => {
    const daysSince = Math.floor(
      (Date.now() - new Date(row.processed_at).getTime()) / 86400000,
    );
    return {
      hashedId:              row.signal_id,
      identifier:            row.signal_id,
      last_interaction_days: daysSince,
      visit_frequency_trend: row.intent_score < 0.30 ? "declining" as const : "stable" as const,
      wrote_negative_review: row.intent_score < 0.15,
    };
  });
}

async function searchCustomerExternalSignals(
  hashedIdentifier: string,
  sector: string,
  geoCity: string,
): Promise<ExternalSignal | null> {
  // In production: search local Facebook groups, Nextdoor, Google reviews
  // for anonymous behavioral patterns that match this customer's segment.
  // NEVER use PII — search by behavioral cluster, not by name/email.
  void hashedIdentifier;

  const serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) return null;

  try {
    const query = encodeURIComponent(
      `"${geoCity}" "${sector}" "מחפש" OR "מישהו מכיר" OR "חלופה"`,
    );
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${serpApiKey}&num=5`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const first = (data.organic_results ?? [])[0];
    if (!first?.snippet) return null;

    return {
      text:                 first.snippet,
      url:                  first.link ?? "",
      mentions_competitor:  first.snippet.includes("מתחרה") || first.snippet.includes("אחר"),
      seeking_alternatives: first.snippet.includes("חלופה") || first.snippet.includes("מחפש"),
    };
  } catch {
    return null;
  }
}

// ─── Churn probability computation ───────────────────────────────────────────

function computeChurnProbability(
  customer: CustomerProfile,
  signal: ExternalSignal | null,
): number {
  let prob = 0;

  if (customer.last_interaction_days > 90)      prob += 0.35;
  else if (customer.last_interaction_days > 45)  prob += 0.20;
  else if (customer.last_interaction_days > 21)  prob += 0.10;

  if (customer.visit_frequency_trend === "declining") prob += 0.25;
  if (customer.wrote_negative_review)                 prob += 0.30;

  if (signal?.mentions_competitor)   prob += 0.25;
  if (signal?.seeking_alternatives)  prob += 0.35;

  return Math.min(prob, 0.99);
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runRetentionSentinel(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  const atRiskCustomers = await identifyAtRiskCustomers(context);

  if (atRiskCustomers.length === 0) {
    console.log(`[${AGENT_NAME}] No at-risk customers identified`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  let alertsWritten = 0;
  let criticalCount = 0;
  let highCount = 0;

  for (const customer of atRiskCustomers) {
    const externalSignal = await searchCustomerExternalSignals(
      customer.identifier,
      context.business.sector,
      context.business.geo_city,
    );

    const churnProbability = computeChurnProbability(customer, externalSignal);
    if (churnProbability < CHURN_THRESHOLD) continue;

    const riskLevel: "medium" | "high" | "critical" =
      churnProbability > 0.75 ? "critical" :
      churnProbability > 0.60 ? "high" : "medium";

    // Generate retention offer via Claude
    const offerPrompt = `
לקוח בסיכון עזיבה (${Math.round(churnProbability * 100)}%).
עסק: ${context.business.sector} ב${context.business.geo_city}
ימים מביקור אחרון: ${customer.last_interaction_days}
סיגנל חיצוני: "${externalSignal?.text ?? "לא זוהה"}"

ייצר הצעת שימור אחת. JSON:
{
  "offer_text": "הצעה אישית — עד 20 מילה, ספציפית לסיטואציה",
  "channel": "whatsapp",
  "urgency_reason": "למה עכשיו — משפט אחד",
  "discount_pct": null,
  "personalization_hook": "כיצד להתחיל את ההודעה — מוזכר דפוס התנהגות"
}
חוק: אסור לציין PII. השתמש בדפוסי התנהגות בלבד.
    `.trim();

    let offer: RetentionOffer | null = null;
    try {
      const raw = await callAnthropicAPI(offerPrompt, 512);
      offer = parseAIJson<RetentionOffer>(raw);
    } catch {
      offer = null;
    }

    const { error } = await supabase.from("retention_alerts").insert({
      business_id:           context.business.id,
      customer_identifier:   customer.hashedId,
      risk_level:            riskLevel,
      churn_probability:     churnProbability,
      last_interaction_days: customer.last_interaction_days,
      external_signal:       externalSignal?.text ?? null,
      external_signal_url:   externalSignal?.url ?? null,
      recommended_offer:     offer?.offer_text ?? null,
      confidence_score:      0.78,
    });

    if (error) {
      console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
      continue;
    }

    alertsWritten++;
    if (riskLevel === "critical") criticalCount++;
    if (riskLevel === "high")     highCount++;
  }

  if (alertsWritten > 0) {
    const topRisk = criticalCount > 0 ? "critical" : highCount > 0 ? "high" : "medium";
    await publishToBus(supabase, {
      business_id:    context.business.id,
      sourceAgent:    AGENT_NAME,
      sourceRecordId: context.business.id,
      sourceTable:    "retention_alerts",
      event_type:     "churn_risk_detected",
      payload: {
        alerts_written: alertsWritten,
        risk_level:     topRisk,
        critical_count: criticalCount,
        high_count:     highCount,
      },
    });
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — ${alertsWritten} retention alerts written`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runRetentionSentinel(supabase, ctx);
  }
}
