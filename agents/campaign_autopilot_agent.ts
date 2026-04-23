// OTXEngine — Agent 20: CampaignAutoPilot
// Trigger: bus events 'trend_spike', 'viral_pattern_detected', 'local_event_detected', 'churn_risk_detected' (high)
// Output: campaign_drafts → publishes 'campaign_draft_ready' to bus
// Mission: Generate platform-specific campaign drafts triggered by real events.
// Invariant: auto_publish is ALWAYS FALSE in MVP. Human must approve before publish.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext } from "./orchestration/types.ts";

const AGENT_NAME = "CampaignAutoPilot";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface CampaignBrief {
  platform:              "instagram" | "facebook" | "tiktok" | "whatsapp";
  format:                "story" | "reel" | "post" | "broadcast";
  headline:              string;
  body_text:             string;
  cta_text:              string;
  target_age_range:      "18-35" | "25-45" | "35-55" | "all";
  geo_radius_km:         number;
  best_publish_datetime: string;
  duration_hours:        number;
  estimated_reach:       number;
  hashtags:              string[];
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runCampaignAutoPilot(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  // Resolve the triggering event from the bus
  let triggerEventType = "scheduled";
  let triggerPayload: Record<string, unknown> = {};

  if (context.busEventId !== "scheduled") {
    const busRow = await supabase
      .from("agent_data_bus")
      .select("event_type, payload")
      .eq("id", context.busEventId)
      .single()
      .then(({ data }) => data as { event_type: string; payload: Record<string, unknown> } | null);

    if (busRow) {
      triggerEventType = busRow.event_type;
      triggerPayload   = busRow.payload;
    }
  }

  // Determine trigger context for the prompt
  const triggerDescription = JSON.stringify(triggerPayload).slice(0, 300);
  const personaName = context.personas?.[0]?.persona_name ?? "לקוח פוטנציאלי";

  const marketingBriefPrompt = `
עסק: ${context.business.name} — ${context.business.sector}
מיקום: ${context.business.geo_city}
טריגר: ${triggerEventType} — ${triggerDescription}
פרסונה מובילה: ${personaName}

בנה קמפיין שיווקי. JSON בלבד:
{
  "platform": "instagram",
  "format": "post",
  "headline": "כותרת — עד 8 מילים",
  "body_text": "גוף הפוסט — עד 50 מילים, עם אמוג'י",
  "cta_text": "קריאה לפעולה — עד 5 מילים",
  "target_age_range": "25-45",
  "geo_radius_km": 5,
  "best_publish_datetime": "${new Date(Date.now() + 3600000).toISOString()}",
  "duration_hours": 24,
  "estimated_reach": 2000,
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}

חוקים:
- headline חייב להתייחס לטריגר הספציפי (אירוע/טרנד/מזג אוויר)
- body_text חייב לכלול את שם העסק ומוצר/שירות ספציפי
- אסור: "מבצע מיוחד", "הזדמנות מצוינת" — כלליות אסורה
  `.trim();

  let campaign: CampaignBrief | null = null;
  try {
    const raw = await callAnthropicAPI(marketingBriefPrompt, 800);
    campaign = parseAIJson<CampaignBrief>(raw);
  } catch (e) {
    console.error(`[${AGENT_NAME}] Campaign generation failed:`, e);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, String(e));
    return;
  }

  const { data: row, error } = await supabase
    .from("campaign_drafts")
    .insert({
      business_id:     context.business.id,
      trigger_event:   triggerEventType,
      platform:        campaign.platform,
      headline:        campaign.headline,
      body_text:       campaign.body_text,
      cta_text:        campaign.cta_text,
      target_audience: {
        age_range:     campaign.target_age_range,
        geo_radius_km: campaign.geo_radius_km,
        hashtags:      campaign.hashtags,
      },
      recommended_time: campaign.best_publish_datetime,
      duration_hours:   campaign.duration_hours,
      estimated_reach:  campaign.estimated_reach,
      auto_publish:     false, // INVARIANT: always false in MVP
      status:           "draft",
      confidence_score: 0.82,
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
    sourceTable:    "campaign_drafts",
    event_type:     "campaign_draft_ready",
    payload: {
      platform:        campaign.platform,
      estimated_reach: campaign.estimated_reach,
      trigger:         triggerEventType,
    },
  });

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(
    `[${AGENT_NAME}] Done — ${campaign.platform} draft for ${context.business.name} (reach: ~${campaign.estimated_reach})`,
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runCampaignAutoPilot(supabase, ctx);
  }
}
