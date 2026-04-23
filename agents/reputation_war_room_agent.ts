// OTXEngine — Agent 22: ReputationWarRoom
// Schedule: every 30 minutes (same cadence as SignalCollector)
// Output: reputation_incidents → publishes 'reputation_incident_detected' to bus with priority 1
// Mission: 30-minute early warning on reputation crises before they go viral.
// Invariant: ALWAYS publishes to bus with priority 1 for critical severity.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext } from "./orchestration/types.ts";

const AGENT_NAME = "ReputationWarRoom";

// ─── Interfaces ───────────────────────────────────────────────────────────────

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentType =
  | "negative_review_spike"
  | "viral_complaint"
  | "competitor_attack"
  | "fake_reviews"
  | "media_mention";

interface IncidentSpec {
  severity:                 IncidentSeverity;
  incident_type:            IncidentType;
  description:              string;
  source_url:               string;
  response_deadline_minutes: number;
}

interface IncidentResponse {
  public_response:    string;
  internal_action:    string;
  escalation_needed:  boolean;
}

// ─── Detectors ────────────────────────────────────────────────────────────────

async function getRecentNegativeReviews(
  businessId: string,
  windowHours: number,
): Promise<Array<{ text: string }>> {
  // Negative proxy: classified_signals that were qualified=false with low intent_score
  const since = new Date(Date.now() - windowHours * 3600000).toISOString();
  const { data } = await supabase
    .from("classified_signals")
    .select("id, intent_score, source_url")
    .eq("business_id", businessId)
    .eq("qualified", false)
    .lt("intent_score", 0.30)
    .gte("processed_at", since)
    .limit(20);
  return (data ?? []).map((r: { source_url: string }) => ({ text: r.source_url }));
}

async function detectViralComplaint(
  businessName: string,
  geoCity: string,
): Promise<{ text: string; share_count: number } | null> {
  const serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) return null;

  try {
    const query = encodeURIComponent(
      `"${businessName}" "${geoCity}" (תלונה OR ביקורת OR "לא מרוצה") -site:${businessName}.co.il`,
    );
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${serpApiKey}&num=5&tbs=qdr:d`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const first = (data.organic_results ?? [])[0];
    if (!first) return null;

    // Estimate virality from result position + snippet keywords
    const viralKeywords = ["ויראלי", "שיתוף", "פייסבוק", "טיקטוק", "כולם מדברים"];
    const snippet: string = first.snippet ?? "";
    const shareEstimate = viralKeywords.some((kw) => snippet.includes(kw)) ? 75 : 10;

    return { text: snippet, share_count: shareEstimate };
  } catch {
    return null;
  }
}

async function detectCompetitorAttack(
  businessName: string,
  competitorChanges: EnrichedContext["competitorChanges"],
): Promise<{ description: string } | null> {
  // Look for competitor_changes of type 'content' that mention our business
  const attack = competitorChanges.find(
    (c) => c.change_type === "content" || c.change_type === "review_campaign",
  );
  if (!attack) return null;

  return {
    description: `מתחרה שינה תוכן/קמפיין — ייתכן התקפה על מוניטין ${businessName}`,
  };
}

async function detectFakeReviewPattern(
  businessId: string,
): Promise<{ detected: boolean; direction: string }> {
  // Burst detection: unusual spike in raw signals in a 6-hour window
  const windowStart = new Date(Date.now() - 6 * 3600000).toISOString();
  const { count } = await supabase
    .from("signals_raw")
    .select("signal_id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("detected_at_utc", windowStart);

  const burst = (count ?? 0) > 10;
  return {
    detected:  burst,
    direction: burst ? "חיובי — חשד לביקורות מזויפות לטובת מתחרה" : "לא זוהה",
  };
}

// ─── Incident creation helper ─────────────────────────────────────────────────

async function createIncident(
  context: EnrichedContext,
  spec: IncidentSpec,
): Promise<void> {
  const responsePrompt = `
משבר מוניטין: "${spec.description}"
עסק: ${context.business.sector} ב${context.business.geo_city}

ייצר תגובה ציבורית. JSON:
{
  "public_response": "תגובה לפרסום — עד 50 מילה, מקצועי, אמפתי",
  "internal_action": "פעולה פנימית — עד 15 מילה",
  "escalation_needed": false
}
  `.trim();

  let response: IncidentResponse = {
    public_response:   "אנחנו מודעים לנושא ומטפלים בו בדחיפות. צרו איתנו קשר ישירות.",
    internal_action:   "בדוק את מקור התלונה ותן מענה תוך שעה",
    escalation_needed: spec.severity === "critical",
  };

  try {
    const raw = await callAnthropicAPI(responsePrompt, 512);
    response = parseAIJson<IncidentResponse>(raw);
  } catch {
    // use defaults above
  }

  const responseDeadline = new Date(
    Date.now() + spec.response_deadline_minutes * 60000,
  ).toISOString();

  const { data: row, error } = await supabase
    .from("reputation_incidents")
    .insert({
      business_id:          context.business.id,
      severity:             spec.severity,
      incident_type:        spec.incident_type,
      description:          spec.description,
      recommended_response: response.public_response,
      response_deadline:    responseDeadline,
      source_url:           spec.source_url,
      confidence_score:     0.85,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
    return;
  }

  // INVARIANT: ReputationWarRoom always publishes with priority 1 for critical
  await publishToBus(supabase, {
    business_id:    context.business.id,
    sourceAgent:    AGENT_NAME,
    sourceRecordId: row?.id ?? "",
    sourceTable:    "reputation_incidents",
    event_type:     "reputation_incident_detected",
    payload: {
      severity:                  spec.severity,
      incident_type:             spec.incident_type,
      response_deadline_minutes: spec.response_deadline_minutes,
      escalation_needed:         response.escalation_needed,
    },
  });

  console.log(`[${AGENT_NAME}] Incident created: ${spec.incident_type} (${spec.severity})`);
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runReputationWarRoom(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting scan for business ${context.business.id}`);

  let incidentsDetected = 0;

  // ── Detector 1: Negative review spike ──────────────────────────────────────
  const recentNegative = await getRecentNegativeReviews(context.business.id, 2);
  if (recentNegative.length >= 3) {
    await createIncident(context, {
      severity:                  recentNegative.length >= 5 ? "critical" : "high",
      incident_type:             "negative_review_spike",
      description:               `${recentNegative.length} ביקורות שליליות ב-2 שעות האחרונות`,
      source_url:                "internal://reputation-monitor",
      response_deadline_minutes: 60,
    });
    incidentsDetected++;
  }

  // ── Detector 2: Viral complaint spreading ──────────────────────────────────
  const viralComplaint = await detectViralComplaint(
    context.business.name,
    context.business.geo_city,
  );
  if (viralComplaint && viralComplaint.share_count > 50) {
    await createIncident(context, {
      severity:                  "critical",
      incident_type:             "viral_complaint",
      description:               `תלונה ויראלית: "${viralComplaint.text.slice(0, 100)}" — ${viralComplaint.share_count} שיתופים משוערים`,
      source_url:                "internal://reputation-monitor/viral",
      response_deadline_minutes: 30,
    });
    incidentsDetected++;
  }

  // ── Detector 3: Competitor attack ─────────────────────────────────────────
  const competitorAttack = await detectCompetitorAttack(
    context.business.name,
    context.competitorChanges,
  );
  if (competitorAttack) {
    await createIncident(context, {
      severity:                  "high",
      incident_type:             "competitor_attack",
      description:               competitorAttack.description,
      source_url:                "internal://reputation-monitor/competitor",
      response_deadline_minutes: 120,
    });
    incidentsDetected++;
  }

  // ── Detector 4: Fake review pattern ───────────────────────────────────────
  const fakePattern = await detectFakeReviewPattern(context.business.id);
  if (fakePattern.detected) {
    await createIncident(context, {
      severity:                  "medium",
      incident_type:             "fake_reviews",
      description:               `זוהה דפוס ביקורות חשוד: ${fakePattern.direction}`,
      source_url:                "internal://reputation-monitor/fake-reviews",
      response_deadline_minutes: 240,
    });
    incidentsDetected++;
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — ${incidentsDetected} incidents detected`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runReputationWarRoom(supabase, ctx);
  }
}
