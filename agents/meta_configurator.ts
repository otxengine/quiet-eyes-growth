// OTXEngine — Agent 12: MetaConfigurator
// Trigger: once on business onboarding (no meta_configurations row) + explicit refresh
// Output: meta_configurations
// INVARIANT: Every business must have a row — fall back to SECTOR_DEFAULTS if AI fails.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "MetaConfigurator";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  sector: "restaurant" | "fitness" | "beauty" | "local";
  geo_city: string;
  price_tier: "budget" | "mid" | "premium" | null;
}

interface MetaConfigAI {
  primary_kpi: string;
  secondary_kpis: string[];
  signal_keywords: string[];
  competitor_search_terms: string[];
  z_score_spike_threshold: number;
  intent_threshold: number;
  local_radius_meters: number;
}

// ─── Sector fallback defaults ─────────────────────────────────────────────────

const SECTOR_DEFAULTS: Record<string, MetaConfigAI> = {
  restaurant: {
    primary_kpi: "table_turns",
    secondary_kpis: ["avg_check", "return_rate"],
    signal_keywords: ["מסעדה", "אוכל", "משלוח", "ביקורת", "תפריט", "שף", "אוכל טעים", "מחיר", "restaurant", "food", "delivery", "review", "menu"],
    competitor_search_terms: ["מסעדה ב", "אוכל ב", "פיצה ב", "סושי ב"],
    z_score_spike_threshold: 1.8,
    intent_threshold: 0.65,
    local_radius_meters: 500,
  },
  fitness: {
    primary_kpi: "active_memberships",
    secondary_kpis: ["class_fill_rate", "churn_rate"],
    signal_keywords: ["חדר כושר", "אימון", "כושר", "מנוי", "ספורט", "פילאטיס", "יוגה", "gym", "fitness", "workout", "training", "yoga", "pilates"],
    competitor_search_terms: ["חדר כושר ב", "אימון ב", "פילאטיס ב", "יוגה ב"],
    z_score_spike_threshold: 2.0,
    intent_threshold: 0.68,
    local_radius_meters: 1000,
  },
  beauty: {
    primary_kpi: "appointment_fill_rate",
    secondary_kpis: ["avg_service_value", "rebooking_rate"],
    signal_keywords: ["מספרה", "טיפול", "ציפורניים", "שיער", "ביוטי", "ספא", "מניקור", "פדיקור", "beauty", "salon", "spa", "hair", "nails", "skin"],
    competitor_search_terms: ["מספרה ב", "טיפול פנים ב", "מניקור ב", "ביוטי ב"],
    z_score_spike_threshold: 1.9,
    intent_threshold: 0.70,
    local_radius_meters: 800,
  },
  local: {
    primary_kpi: "daily_footfall",
    secondary_kpis: ["conversion_rate", "avg_transaction"],
    signal_keywords: ["שירות", "תיקון", "מקומי", "איכות", "מחיר", "עסק", "שכונה", "local", "service", "repair", "business", "community"],
    competitor_search_terms: ["שירות ב", "תיקון ב", "עסק ב"],
    z_score_spike_threshold: 2.0,
    intent_threshold: 0.65,
    local_radius_meters: 1500,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function applyGuardrails(cfg: Partial<MetaConfigAI>, sector: string): MetaConfigAI {
  const def = SECTOR_DEFAULTS[sector] ?? SECTOR_DEFAULTS.local;
  return {
    primary_kpi:             cfg.primary_kpi             ?? def.primary_kpi,
    secondary_kpis:          cfg.secondary_kpis?.length  ? cfg.secondary_kpis : def.secondary_kpis,
    signal_keywords:         cfg.signal_keywords?.length ? cfg.signal_keywords : def.signal_keywords,
    competitor_search_terms: cfg.competitor_search_terms ?? def.competitor_search_terms,
    z_score_spike_threshold: clamp(cfg.z_score_spike_threshold ?? def.z_score_spike_threshold, 1.5, 2.5),
    intent_threshold:        clamp(cfg.intent_threshold        ?? def.intent_threshold,        0.55, 0.80),
    local_radius_meters:     clamp(cfg.local_radius_meters     ?? def.local_radius_meters,     300, 2000),
  };
}

// ─── AI-assisted KPI discovery ────────────────────────────────────────────────

async function discoverConfigViaAI(biz: Business): Promise<MetaConfigAI> {
  const prompt = `
סקטור: ${biz.sector}
עיר: ${biz.geo_city}
רמת מחיר: ${biz.price_tier ?? "mid"}
שם עסק: ${biz.name}

מהם 3 ה-KPIs הקריטיים לעסק זה בישראל?
ענה בפורמט JSON בלבד:
{
  "primary_kpi": "שם KPI ראשי (עד שתי מילים)",
  "secondary_kpis": ["kpi2", "kpi3"],
  "signal_keywords": ["מילה1","מילה2","מילה3","מילה4","מילה5","מילה6","מילה7","מילה8","מילה9","מילה10","word11","word12","word13","word14","word15"],
  "competitor_search_terms": ["ביטוי1","ביטוי2","ביטוי3","ביטוי4","ביטוי5"],
  "z_score_spike_threshold": 1.8,
  "intent_threshold": 0.65,
  "local_radius_meters": 500
}
חובה: 10-15 signal_keywords, שילוב עברית+אנגלית. אסור: הסברים, מפתחות נוספים.
`;
  const raw = await callAnthropicAPI(prompt, 1024);
  return parseAIJson<MetaConfigAI>(raw);
}

// ─── Configure a single business ─────────────────────────────────────────────

async function configureForBusiness(biz: Business): Promise<void> {
  console.log(`[${AGENT_NAME}] Configuring ${biz.name} (${biz.id})`);

  let aiCfg: Partial<MetaConfigAI> = {};
  try {
    aiCfg = await discoverConfigViaAI(biz);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[${AGENT_NAME}] AI discovery failed for ${biz.name} — using sector defaults: ${msg}`);
  }

  const finalCfg = applyGuardrails(aiCfg, biz.sector);

  const { data: existing } = await supabase
    .from("meta_configurations")
    .select("configuration_version")
    .eq("business_id", biz.id)
    .maybeSingle();

  const nextVersion = ((existing as { configuration_version: number } | null)?.configuration_version ?? 0) + 1;

  const { error } = await supabase.from("meta_configurations").upsert({
    business_id:             biz.id,
    sector:                  biz.sector,
    auto_detected_kpis:      { primary: finalCfg.primary_kpi, secondary: finalCfg.secondary_kpis },
    signal_keywords:         finalCfg.signal_keywords,
    trend_thresholds:        { z_score_spike: finalCfg.z_score_spike_threshold, intent_threshold: finalCfg.intent_threshold },
    competitor_search_terms: finalCfg.competitor_search_terms,
    local_radius_meters:     finalCfg.local_radius_meters,
    configured_at:           new Date().toISOString(),
    configuration_version:   nextVersion,
  }, { onConflict: "business_id" });

  if (error) throw error;

  console.log(
    `[${AGENT_NAME}] ✓ ${biz.name} v${nextVersion} | ` +
    `kpi=${finalCfg.primary_kpi} | keywords=${finalCfg.signal_keywords.length} | radius=${finalCfg.local_radius_meters}m`,
  );
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  const bizList = (businesses ?? []) as Business[];

  // Find businesses without a meta_configuration row
  const { data: configured } = await supabase
    .from("meta_configurations")
    .select("business_id");

  const configuredIds = new Set(
    ((configured ?? []) as { business_id: string }[]).map((r) => r.business_id),
  );

  const unconfigured = bizList.filter((b) => !configuredIds.has(b.id));

  if (unconfigured.length === 0) {
    console.log(`[${AGENT_NAME}] All ${bizList.length} businesses already configured`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  console.log(`[${AGENT_NAME}] Found ${unconfigured.length} unconfigured business(es)`);

  let successCount = 0;
  let errorCount = 0;

  for (const biz of unconfigured) {
    try {
      await configureForBusiness(biz);
      successCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed to configure ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Config failed for ${biz.name}: ${msg}`);
      errorCount++;
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} businesses failed to configure` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Configured: ${successCount}, Errors: ${errorCount}. Ping: ${now}`);

  // Notify all agents that config was updated — they should re-read their thresholds
  for (const biz of unconfigured.slice(0, successCount)) {
    await publishToBus(supabase, {
      business_id:    biz.id,
      sourceAgent:    AGENT_NAME,
      sourceRecordId: crypto.randomUUID(),
      sourceTable:    "meta_configurations",
      event_type:     "config_updated",
      payload:        { sector: biz.sector, version: 1 },
    }).catch(() => {/* non-critical */});
  }
}

if (import.meta.main) {
  await run();
}
