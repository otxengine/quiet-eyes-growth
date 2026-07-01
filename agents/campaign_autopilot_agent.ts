// OTXEngine — Agent 20: CampaignAutoPilot
// Trigger: bus events 'trend_spike', 'viral_pattern_detected', 'local_event_detected', 'churn_risk_detected' (high)
// Output: campaign_drafts → publishes 'campaign_draft_ready' to bus
// Mission: Generate platform-specific campaign drafts triggered by real events.
// Auto-publish: set to TRUE only when the campaign satisfies all user-specified guidelines
// (patent §[0071]): permitted_platforms, estimated_reach within budget, permitted publish hours.
// If any guideline is not satisfied the draft stays status='draft', auto_publish=false.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext } from "./orchestration/types.ts";

const AGENT_NAME = "CampaignAutoPilot";

// ─── Interfaces ───────────────────────────────────────────────────────────────

// User-specified guidelines stored in meta_configurations.user_guidelines
interface CampaignGuidelines {
  permitted_platforms?:     string[];
  max_ad_budget_ils?:       number;
  permitted_publish_hours?: { start: number; end: number };
  max_daily_actions?:       number;
}

// Estimated cost per 1000 reach impressions (ILS) per platform — conservative floor.
const COST_PER_1K_ILS: Record<string, number> = {
  instagram: 12,
  facebook:  10,
  tiktok:    8,
  whatsapp:  3,
};

// Returns { ok: true } if the campaign satisfies all user-specified guidelines.
// Returns { ok: false, reason } if any guideline blocks auto-publish (patent §[0071]).
function checkCampaignGuidelines(
  campaign: CampaignBrief,
  guidelines: CampaignGuidelines,
): { ok: boolean; reason?: string } {
  // 1. Permitted platforms
  const permitted = guidelines.permitted_platforms;
  if (permitted && permitted.length > 0 && !permitted.includes(campaign.platform)) {
    return { ok: false, reason: `platform '${campaign.platform}' not in permitted_platforms` };
  }

  // 2. Budget constraint — estimated cost must not exceed max_ad_budget_ils
  const maxBudget = guidelines.max_ad_budget_ils;
  if (maxBudget != null && campaign.estimated_reach > 0) {
    const costPer1k = COST_PER_1K_ILS[campaign.platform] ?? 12;
    const estimatedCost = (campaign.estimated_reach / 1000) * costPer1k;
    if (estimatedCost > maxBudget) {
      return {
        ok: false,
        reason: `estimated cost ~${Math.round(estimatedCost)} ILS exceeds budget ${maxBudget} ILS`,
      };
    }
  }

  // 3. Permitted publish hours
  const hours = guidelines.permitted_publish_hours;
  if (hours) {
    const publishHour = new Date(campaign.best_publish_datetime).getHours();
    if (publishHour < hours.start || publishHour >= hours.end) {
      return {
        ok: false,
        reason: `publish hour ${publishHour} outside permitted window ${hours.start}–${hours.end}`,
      };
    }
  }

  return { ok: true };
}

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

  // Read user-specified guidelines (patent §[0025]-[0026], §[0071]).
  // Auto-publish only when ALL guidelines are satisfied.
  const { data: metaRow } = await supabase
    .from("meta_configurations")
    .select("user_guidelines")
    .eq("business_id", context.business.id)
    .maybeSingle();

  const guidelines: CampaignGuidelines = (metaRow?.user_guidelines as CampaignGuidelines) ?? {};
  const guidelineCheck = checkCampaignGuidelines(campaign, guidelines);
  const autoPublish    = guidelineCheck.ok;
  const status         = autoPublish ? "approved" : "draft";

  if (!autoPublish) {
    console.log(
      `[${AGENT_NAME}] Guidelines not satisfied — staying draft. Reason: ${guidelineCheck.reason}`,
    );
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
      auto_publish:     autoPublish,
      status,
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
      auto_publish:    autoPublish,
      status,
    },
  });

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(
    `[${AGENT_NAME}] Done — ${campaign.platform} draft for ${context.business.name}` +
    ` (reach: ~${campaign.estimated_reach}, status: ${status})`,
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
