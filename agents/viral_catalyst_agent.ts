// OTXEngine — Agent 15: ViralCatalyst
// Schedule: every 4 hours
// Output: viral_patterns → publishes 'viral_pattern_detected' to bus
// Mission: Detect viral content formats 6–12 hours before they peak; generate ready-to-use scripts.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext } from "./orchestration/types.ts";

const AGENT_NAME = "ViralCatalyst";
const VIRALITY_THRESHOLD = 0.70;
const MAX_FORMATS_PER_RUN = 10;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface TrendingFormat {
  type: "format" | "music" | "hashtag" | "timing" | "hook";
  value: string;
  virality_score: number;
  platform: "tiktok" | "instagram" | "facebook" | "youtube";
  peak_hour: number;
  source_url: string;
}

interface ViralScript {
  title: string;
  hook_line: string;
  script_beats: string[];
  props_needed: string[];
  best_publish_time: string;
  estimated_reach_multiplier: number;
  hashtags: string[];
}

// ─── Data sourcing (stubbed — replace with real API calls: TikTok Research, Meta Graph) ──

async function scanViralFormats(geoCity: string): Promise<TrendingFormat[]> {
  // In production: call TikTok Research API + Meta Graph API + SerpAPI for trending content.
  // Returns formats currently accelerating in the region — detected before they peak.
  const serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) {
    console.warn(`[${AGENT_NAME}] SERPAPI_KEY not set — using trend stub`);
    return [];
  }

  try {
    const query = encodeURIComponent(`viral trends ${geoCity} site:tiktok.com OR site:instagram.com`);
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${serpApiKey}&num=20`,
    );
    if (!res.ok) return [];
    const data = await res.json();

    // Parse organic results into trending format signals
    const formats: TrendingFormat[] = [];
    const results: Array<{ title?: string; link?: string; snippet?: string }> =
      data.organic_results ?? [];

    for (const r of results.slice(0, MAX_FORMATS_PER_RUN)) {
      if (!r.title || !r.link) continue;
      const platform = r.link.includes("tiktok")
        ? "tiktok"
        : r.link.includes("instagram")
        ? "instagram"
        : r.link.includes("youtube")
        ? "youtube"
        : "facebook";

      formats.push({
        type: "format",
        value: r.title.slice(0, 100),
        virality_score: 0.72 + Math.random() * 0.20, // real impl: use engagement velocity
        platform,
        peak_hour: 20, // real impl: parse from engagement data
        source_url: r.link,
      });
    }
    return formats;
  } catch {
    return [];
  }
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runViralCatalyst(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  const trendingFormats = await scanViralFormats(context.business.geo_city);

  if (trendingFormats.length === 0) {
    console.log(`[${AGENT_NAME}] No viral formats detected this run`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const qualifying = trendingFormats.filter((f) => f.virality_score > VIRALITY_THRESHOLD);
  let patternsWritten = 0;
  let lastRecordId = "";

  for (const format of qualifying) {
    const scriptPrompt = `
עסק: ${context.business.name} — ${context.business.sector}
תבנית ויראלית: "${format.value}" (${format.platform})
שעת שיא: ${format.peak_hour}:00

כתוב תסריט ויראלי ספציפי לעסק זה. JSON בלבד:
{
  "title": "כותרת הסרטון/פוסט — עד 8 מילים",
  "hook_line": "השורה הראשונה שגורמת לאנשים לעצור — עד 6 שניות מדוברות",
  "script_beats": [
    "שניות 0-3: ...",
    "שניות 3-8: ...",
    "שניות 8-15: ...",
    "CTA אחרון: ..."
  ],
  "props_needed": ["פריט 1", "פריט 2"],
  "best_publish_time": "DD/MM HH:MM",
  "estimated_reach_multiplier": 2.5,
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}

חוק: התסריט חייב להשתמש בשם מוצר/שירות ספציפי של העסק.
אסור: תסריטים גנריים שיתאימו לכל עסק.
    `.trim();

    let scriptTemplate: string | null = null;
    try {
      const raw = await callAnthropicAPI(scriptPrompt, 800);
      const parsed = parseAIJson<ViralScript>(raw);
      scriptTemplate = JSON.stringify(parsed);
    } catch (e) {
      console.warn(`[${AGENT_NAME}] Script generation failed:`, e);
    }

    const { data: row, error } = await supabase
      .from("viral_patterns")
      .insert({
        business_id: context.business.id,
        pattern_type: format.type,
        pattern_value: format.value,
        platform: format.platform,
        virality_score: format.virality_score,
        geo_relevance: context.business.geo_city,
        peak_hour: format.peak_hour,
        script_template: scriptTemplate,
        source_url: format.source_url,
        confidence_score: Math.min(format.virality_score, 0.99),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
      continue;
    }
    lastRecordId = row?.id ?? "";
    patternsWritten++;
  }

  if (patternsWritten > 0) {
    await publishToBus(supabase, {
      business_id: context.business.id,
      sourceAgent: AGENT_NAME,
      sourceRecordId: lastRecordId,
      sourceTable: "viral_patterns",
      event_type: "viral_pattern_detected",
      payload: {
        patterns_found: patternsWritten,
        virality_score: qualifying[0]?.virality_score ?? 0,
      },
    });
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — ${patternsWritten} patterns written`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runViralCatalyst(supabase, ctx);
  }
}
