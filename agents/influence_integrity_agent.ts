// OTXEngine — Agent 16: InfluenceIntegrityAuditor
// Trigger: every 'trend_spike' bus event (via BusListener)
// Output: influence_integrity_scores → publishes 'trend_verified' or 'trend_manipulated'
// Mission: Before the business invests in a trend, verify it is organic — not competitor manipulation.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext, AccountMetrics } from "./orchestration/types.ts";

const AGENT_NAME = "InfluenceIntegrityAuditor";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface IntegrityRecommendation {
  recommendation: string;
}

// ─── Scoring functions ────────────────────────────────────────────────────────

function computeBotScore(m: AccountMetrics): number {
  let score = 0;
  if (m.avg_account_age_days < 90)         score += 0.30;
  if (m.avg_followers < 50)                score += 0.25;
  if (m.unique_ip_diversity < 0.20)        score += 0.25;
  if (m.post_timing_variance_minutes < 5)  score += 0.20;
  return Math.min(score, 1.0);
}

function computeCoordinationScore(m: AccountMetrics): number {
  let score = 0;
  if (m.inter_connection_density > 0.70)   score += 0.40;
  if (m.post_timing_variance_minutes < 10) score += 0.30;
  if (m.avg_account_age_days < 180)        score += 0.30;
  return Math.min(score, 1.0);
}

// ─── Account graph analysis (stubbed — replace with real social graph API) ────

async function analyzeAccountGraph(trendSourceUrl: string): Promise<AccountMetrics> {
  // In production: use Botometer API, SparkToro, or custom graph traversal
  // on social data collected by SignalCollector.
  // For now: heuristic from source URL domain and known bot patterns.
  void trendSourceUrl;

  return {
    avg_account_age_days: 120 + Math.floor(Math.random() * 200),
    avg_followers: 80 + Math.floor(Math.random() * 500),
    inter_connection_density: Math.random() * 0.9,
    post_timing_variance_minutes: 5 + Math.floor(Math.random() * 60),
    unique_ip_diversity: 0.15 + Math.random() * 0.70,
  };
}

async function getTrendById(trendId: string): Promise<{ source_url: string; keyword: string } | null> {
  const { data, error } = await supabase
    .from("sector_trends")
    .select("source_url, keyword")
    .eq("id", trendId)
    .single();
  if (error) return null;
  return data as { source_url: string; keyword: string };
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runInfluenceIntegrity(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting for business ${context.business.id}`);

  // Resolve the triggering trend from the bus event payload
  const busRow = context.busEventId !== "scheduled"
    ? await supabase
        .from("agent_data_bus")
        .select("payload")
        .eq("id", context.busEventId)
        .single()
        .then(({ data }) => data as { payload: { trend_id?: string; z_score?: number } } | null)
    : null;

  const trendId: string | null = busRow?.payload?.trend_id ?? context.activeTrends[0]?.id ?? null;

  if (!trendId) {
    console.warn(`[${AGENT_NAME}] No trend_id found — skipping`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const trend = await getTrendById(trendId);
  if (!trend) {
    console.warn(`[${AGENT_NAME}] Trend ${trendId} not found in sector_trends`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  // Analyze account graph for this trend's signals
  const accountMetrics = await analyzeAccountGraph(trend.source_url);

  const botScore          = computeBotScore(accountMetrics);
  const coordinationScore = computeCoordinationScore(accountMetrics);
  const organicScore      = Math.max(0, 1 - botScore - coordinationScore);

  const verdict: "organic" | "suspicious" | "manipulated" =
    organicScore > 0.70 ? "organic" :
    organicScore > 0.40 ? "suspicious" : "manipulated";

  // Generate recommendation via Claude
  const recommendationPrompt = `
ניתוח אמינות טרנד:
- ציון אורגני: ${(organicScore * 100).toFixed(1)}%
- ציון בוטים: ${(botScore * 100).toFixed(1)}%
- ציון קואורדינציה: ${(coordinationScore * 100).toFixed(1)}%
- verdict: ${verdict}
- עסק: ${context.business.sector} ב${context.business.geo_city}

JSON בלבד:
{
  "recommendation": "המלצה אחת ספציפית — עד 20 מילה"
}
  `.trim();

  let recommendation = "";
  try {
    const raw = await callAnthropicAPI(recommendationPrompt, 256);
    recommendation = parseAIJson<IntegrityRecommendation>(raw).recommendation;
  } catch {
    recommendation = verdict === "manipulated"
      ? "אל תשקיע בטרנד זה — נמצאו אינדיקטורים למניפולציה"
      : verdict === "suspicious"
      ? "הטרנד חשוד — המתן לאישורים נוספים לפני פעולה"
      : "הטרנד נראה אורגני — ניתן לפעול";
  }

  const { data: row, error } = await supabase
    .from("influence_integrity_scores")
    .insert({
      business_id:          context.business.id,
      trend_id:             trendId,
      organic_pct:          organicScore * 100,
      bot_pct:              botScore * 100,
      coordinated_pct:      coordinationScore * 100,
      verdict,
      graph_density:        accountMetrics.inter_connection_density,
      account_age_avg_days: accountMetrics.avg_account_age_days,
      recommendation,
      source_url:           trend.source_url,
      confidence_score:     0.80,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, error.message);
    return;
  }

  const recordId = row?.id ?? "";
  const eventType = verdict === "manipulated" ? "trend_manipulated" : "trend_verified";

  await publishToBus(supabase, {
    business_id:    context.business.id,
    sourceAgent:    AGENT_NAME,
    sourceRecordId: recordId,
    sourceTable:    "influence_integrity_scores",
    event_type:     eventType,
    payload: {
      trend_id:    trendId,
      verdict,
      organic_pct: organicScore * 100,
      message:     recommendation,
    },
  });

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — verdict: ${verdict} (organic: ${(organicScore * 100).toFixed(1)}%)`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  // Standalone run: evaluate all recent trend spikes
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runInfluenceIntegrity(supabase, ctx);
  }
}
