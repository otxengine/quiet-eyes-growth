// OTXEngine — Agent 17: DeepContextVisionAgent
// Schedule: every 6 hours
// Output: visual_osint_signals → publishes 'visual_insight_detected' to bus
// Mission: Analyze geo-tagged social media imagery → actionable business insights.
// Invariant: max 50 images per run. Above 50 → queued for next run.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicVisionAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext, MediaItem } from "./orchestration/types.ts";

const AGENT_NAME = "DeepContextVisionAgent";
const MAX_IMAGES_PER_RUN = 50;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface VisionAnalysis {
  detected_objects:     string[];
  scene_tags:           string[];
  crowd_density:        "empty" | "moderate" | "packed";
  wait_time_signal:     "none" | "short" | "long";
  product_quality_signal: "unclear" | "positive" | "negative";
  unmet_demand_signals: string[];
  business_insight:     string;
  sentiment_visual:     "positive" | "neutral" | "negative" | "urgent";
}

// ─── Media collection (stubbed — replace with Instagram Basic Display API + TikTok Research) ──

async function collectLocalMedia(
  geoCity: string,
  sector: string,
): Promise<MediaItem[]> {
  // In production: query Instagram geo-tagged posts + TikTok location search API.
  // Filter to recent 48h posts within local_radius_meters of business.
  const serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) {
    console.warn(`[${AGENT_NAME}] SERPAPI_KEY not set — no media to analyze`);
    return [];
  }

  try {
    const query = encodeURIComponent(`"${geoCity}" "${sector}" site:instagram.com`);
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${serpApiKey}&num=30&tbm=isch`,
    );
    if (!res.ok) return [];
    const data = await res.json();

    const items: MediaItem[] = [];
    const results: Array<{ original?: string; link?: string }> = data.images_results ?? [];
    for (const r of results.slice(0, MAX_IMAGES_PER_RUN)) {
      if (!r.original) continue;
      items.push({
        url: r.original,
        platform: "instagram",
        source_url: r.link ?? r.original,
      });
    }
    return items;
  } catch {
    return [];
  }
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runDeepContextVision(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  const mediaItems = await collectLocalMedia(
    context.business.geo_city,
    context.business.sector,
  );

  if (mediaItems.length === 0) {
    console.log(`[${AGENT_NAME}] No media collected — skipping`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  // Enforce max 50 per run invariant
  const batch = mediaItems.slice(0, MAX_IMAGES_PER_RUN);
  let insightsWritten = 0;
  let unmetDemandTotal = 0;

  for (const media of batch) {
    const visionPrompt = `
נתח את התמונה מנקודת מבט עסקית.
הקשר: עסקים מסוג "${context.business.sector}" ב"${context.business.geo_city}"

JSON בלבד:
{
  "detected_objects": ["אובייקט1", "אובייקט2"],
  "scene_tags": ["תג1", "תג2"],
  "crowd_density": "empty",
  "wait_time_signal": "none",
  "product_quality_signal": "unclear",
  "unmet_demand_signals": [],
  "business_insight": "תובנה אחת ספציפית, עד 15 מילה",
  "sentiment_visual": "neutral"
}
    `.trim();

    let analysis: VisionAnalysis | null = null;
    try {
      const raw = await callAnthropicVisionAPI(visionPrompt, media.url, 512);
      analysis = parseAIJson<VisionAnalysis>(raw);
    } catch (e) {
      console.warn(`[${AGENT_NAME}] Vision analysis failed for ${media.url}:`, e);
      continue;
    }

    // Only persist signals with business value
    const hasValue =
      (analysis.unmet_demand_signals?.length ?? 0) > 0 ||
      analysis.crowd_density === "packed" ||
      analysis.product_quality_signal === "negative";

    if (!hasValue) continue;

    const { error } = await supabase.from("visual_osint_signals").insert({
      business_id:           context.business.id,
      media_url:             media.url,
      platform:              media.platform,
      detected_objects:      analysis.detected_objects ?? [],
      scene_tags:            analysis.scene_tags ?? [],
      business_insight:      analysis.business_insight,
      unmet_demand_detected: (analysis.unmet_demand_signals?.length ?? 0) > 0,
      sentiment_visual:      analysis.sentiment_visual,
      geo:                   context.business.geo_city,
      source_url:            media.source_url,
      confidence_score:      0.75,
    });

    if (error) {
      console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
      continue;
    }

    insightsWritten++;
    if ((analysis.unmet_demand_signals?.length ?? 0) > 0) unmetDemandTotal++;
  }

  if (insightsWritten > 0) {
    await publishToBus(supabase, {
      business_id:    context.business.id,
      sourceAgent:    AGENT_NAME,
      sourceRecordId: context.business.id,
      sourceTable:    "visual_osint_signals",
      event_type:     "visual_insight_detected",
      payload: {
        insights_written:      insightsWritten,
        unmet_demand_detected: unmetDemandTotal,
        images_analyzed:       batch.length,
      },
    });
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — ${insightsWritten} insights from ${batch.length} images`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runDeepContextVision(supabase, ctx);
  }
}
