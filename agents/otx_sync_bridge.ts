// OTXEngine — OTXSyncBridge
// Reads OTX tables → writes into QuietEyes Prisma tables (same DB)
// Fans out to ALL registered QuietEyes business profiles.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "OTXSyncBridge";

function uid(): string { return crypto.randomUUID(); }

interface QEProfile { id: string; created_by: string; sector: string; }

// Map QE category labels to OTX sector keys
const CATEGORY_TO_SECTOR: Record<string, string> = {
  "מסעדה": "restaurant", "בית קפה": "restaurant", "פיצרייה": "restaurant",
  "פלאפל": "restaurant", "שווארמה": "restaurant", "קייטרינג": "restaurant",
  "מכון כושר": "fitness", "סטודיו ליוגה": "fitness", "סטודיו לפילאטיס": "fitness",
  "חנות ספורט": "fitness",
  "מספרה": "beauty", "מכון יופי": "beauty", "אופטיקה": "beauty",
};

function categoryToSector(category: string): string {
  return CATEGORY_TO_SECTOR[category] ?? "local";
}

// Fetch all registered QuietEyes business profiles with sector
async function fetchQEProfiles(): Promise<QEProfile[]> {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("id, created_by, category")
    .not("created_by", "is", null);
  if (error) throw error;
  return (data ?? []).map((r: { id: string; created_by: string; category: string }) => ({
    id: r.id,
    created_by: r.created_by,
    sector: categoryToSector(r.category ?? ""),
  })) as QEProfile[];
}

// ── Fetch OTX business sectors ────────────────────────────────────────────────
// Returns Map<otx_business_id, sector>

async function fetchOTXBusinessSectors(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, sector");
  if (error) throw error;
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; sector: string }[]) {
    m.set(r.id, r.sector);
  }
  return m;
}

// Filter profiles to those whose sector matches the given OTX business sector.
// Profiles with sector "local" always receive data.
function profilesForSector(profiles: QEProfile[], otxSector: string): QEProfile[] {
  return profiles.filter(p => p.sector === otxSector || p.sector === "local");
}

// ── Cleanup contaminated records ──────────────────────────────────────────────
// Deletes OTX-sourced leads/raw_signals/market_signals fanned out to profiles
// from a non-matching sector (AC4: covers all three QE target tables).

async function cleanContaminatedData(profiles: QEProfile[], bizSectors: Map<string, string>): Promise<void> {
  const nonLocalProfiles = profiles.filter(p => p.sector !== "local");
  if (nonLocalProfiles.length === 0) return;

  const [{ data: signals }, { data: rawSigs }, { data: compChanges }, { data: sectorTrends }] = await Promise.all([
    supabase.from("classified_signals").select("id, business_id"),
    supabase.from("signals_raw").select("signal_id, business_id"),
    supabase.from("competitor_changes").select("id, business_id"),
    supabase.from("sector_trends").select("id, sector"),
  ]);

  const signalSector = new Map<string, string>();
  for (const s of (signals ?? []) as { id: string; business_id: string }[]) {
    const sector = bizSectors.get(s.business_id);
    if (sector) signalSector.set(s.id, sector);
  }
  const rawSector = new Map<string, string>();
  for (const s of (rawSigs ?? []) as { signal_id: string; business_id: string }[]) {
    const sector = bizSectors.get(s.business_id);
    if (sector) rawSector.set(s.signal_id, sector);
  }
  const compSector = new Map<string, string>();
  for (const c of (compChanges ?? []) as { id: string; business_id: string }[]) {
    const sector = bizSectors.get(c.business_id);
    if (sector) compSector.set(c.id, sector);
  }
  const trendSector = new Map<string, string>();
  for (const t of (sectorTrends ?? []) as { id: string; sector: string }[]) {
    trendSector.set(t.id, t.sector);
  }

  for (const profile of nonLocalProfiles) {
    // --- Clean leads ---
    const { data: leads } = await supabase
      .from("leads").select("id, source_description")
      .eq("linked_business", profile.id).eq("source_origin", "otx_engine")
      .like("source_description", "otx_sig:%");
    const badLeadIds: string[] = [];
    for (const l of (leads ?? []) as { id: string; source_description: string }[]) {
      const srcSector = signalSector.get(l.source_description.split(":")[1]);
      if (srcSector && srcSector !== profile.sector) badLeadIds.push(l.id);
    }
    if (badLeadIds.length > 0) {
      await supabase.from("leads").delete().in("id", badLeadIds);
      console.log(`[Cleanup] Removed ${badLeadIds.length} contaminated leads from profile ${profile.id}`);
    }

    // --- Clean raw_signals ---
    const { data: rawSignals } = await supabase
      .from("raw_signals").select("id, checksum_hash")
      .eq("linked_business", profile.id).eq("source_origin", "otx_engine")
      .like("checksum_hash", "otx:%");
    const badRawIds: string[] = [];
    for (const r of (rawSignals ?? []) as { id: string; checksum_hash: string }[]) {
      const srcSector = rawSector.get(r.checksum_hash.split(":")[1]);
      if (srcSector && srcSector !== profile.sector) badRawIds.push(r.id);
    }
    if (badRawIds.length > 0) {
      await supabase.from("raw_signals").delete().in("id", badRawIds);
      console.log(`[Cleanup] Removed ${badRawIds.length} contaminated raw_signals from profile ${profile.id}`);
    }

    // --- Clean market_signals (trends + comp_changes; event_opps fan to all so never contaminated) ---
    const { data: mktSignals } = await supabase
      .from("market_signals").select("id, source_description")
      .eq("linked_business", profile.id)
      .or("source_description.like.otx_trend:%,source_description.like.otx_comp:%");
    const badMktIds: string[] = [];
    for (const m of (mktSignals ?? []) as { id: string; source_description: string }[]) {
      const desc = m.source_description;
      if (desc.startsWith("otx_trend:")) {
        const srcSector = trendSector.get(desc.split(":")[1]);
        if (srcSector && srcSector !== profile.sector) badMktIds.push(m.id);
      } else if (desc.startsWith("otx_comp:")) {
        const srcSector = compSector.get(desc.split(":")[1]);
        if (srcSector && srcSector !== profile.sector) badMktIds.push(m.id);
      }
    }
    if (badMktIds.length > 0) {
      await supabase.from("market_signals").delete().in("id", badMktIds);
      console.log(`[Cleanup] Removed ${badMktIds.length} contaminated market_signals from profile ${profile.id}`);
    }
  }
}

// ── 1. classified_signals → leads ────────────────────────────────────────────
// Dedup: source_description = "otx_sig:{signalId}:{bpId}"
// Only fans out to QE profiles whose sector matches the OTX source business.

async function syncLeads(profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data: existing } = await supabase
    .from("leads")
    .select("source_description")
    .like("source_description", "otx_sig:%");

  const synced = new Set(
    (existing ?? []).map((r: { source_description: string | null }) => r.source_description ?? ""),
  );

  const { data, error } = await supabase
    .from("classified_signals")
    .select("id, business_id, intent_score, geo_match_score, sector_match_score, source_url, confidence_score, processed_at")
    .eq("qualified", true)
    .order("processed_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data?.length) return 0;

  const leads = [];
  for (const r of data as {
    id: string; business_id: string; intent_score: number;
    geo_match_score: number; sector_match_score: number;
    source_url: string; confidence_score: number; processed_at: string;
  }[]) {
    const otxSector = bizSectors.get(r.business_id) ?? "local";
    const targetProfiles = profilesForSector(profiles, otxSector);
    for (const profile of targetProfiles) {
      const key = `otx_sig:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      const score = Math.round((0.5 * r.intent_score + 0.3 * r.sector_match_score + 0.2 * r.geo_match_score) * 100);
      const intentStrength = r.intent_score >= 0.85 ? "high" : r.intent_score >= 0.7 ? "medium" : "low";
      let hostname = r.source_url;
      try { hostname = new URL(r.source_url).hostname; } catch { /* keep raw */ }
      leads.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        name: `ליד OTX | ${hostname}`, source: "otx_engine", score,
        status: score >= 80 ? "hot" : score >= 60 ? "warm" : "new",
        intent_source: r.source_url, intent_strength: intentStrength,
        source_url: r.source_url, source_origin: "otx_engine",
        source_description: key,
        discovery_method: "otx_signal", freshness_score: 100,
        discovered_at: r.processed_at, created_at: r.processed_at,
        lifecycle_stage: "new",
      });
    }
  }

  if (leads.length === 0) return 0;
  const { error: ie } = await supabase.from("leads").insert(leads);
  if (ie) throw ie;
  return leads.length;
}

// ── 2. signals_raw → raw_signals ──────────────────────────────────────────────
// Dedup: checksum_hash = "otx:{signalId}:{bpId}"
// Only fans out to QE profiles whose sector matches the OTX source business.

async function syncRawSignals(profiles: QEProfile[], bizSectors: Map<string, string>): Promise<{ count: number; lagMs: number | null }> {
  if (profiles.length === 0) return { count: 0, lagMs: null };

  const { data: existing } = await supabase
    .from("raw_signals")
    .select("checksum_hash")
    .like("checksum_hash", "otx:%");

  const synced = new Set(
    (existing ?? []).map((r: { checksum_hash: string | null }) => r.checksum_hash ?? ""),
  );

  const { data, error } = await supabase
    .from("signals_raw")
    .select("signal_id, business_id, source_type, source_url, raw_text, geo, detected_at_utc, confidence_score")
    .order("detected_at_utc", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data?.length) return { count: 0, lagMs: null };

  // AC5: lag from oldest fetched signals_raw row to now
  const oldestTs = Math.min(...(data as { detected_at_utc: string }[]).map(r => Date.parse(r.detected_at_utc)));
  const lagMs = Number.isFinite(oldestTs) ? Date.now() - oldestTs : null;

  const typeMap: Record<string, string> = {
    social: "social_mention", forum: "social_mention", trend: "social_trend",
  };

  const rawSignals = [];
  for (const r of data as {
    signal_id: string; business_id: string; source_type: string;
    source_url: string; raw_text: string; geo: string | null;
    detected_at_utc: string; confidence_score: number;
  }[]) {
    const otxSector = bizSectors.get(r.business_id) ?? "local";
    const targetProfiles = profilesForSector(profiles, otxSector);
    for (const profile of targetProfiles) {
      const key = `otx:${r.signal_id}:${profile.id}`;
      if (synced.has(key)) continue;
      rawSignals.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        source: r.source_url, content: r.raw_text.slice(0, 2000),
        url: r.source_url, signal_type: typeMap[r.source_type] ?? "social_mention",
        platform: r.source_type, sentiment: "unknown",
        checksum_hash: key, detected_at: r.detected_at_utc,
        source_origin: "otx_engine",
      });
    }
  }

  if (rawSignals.length === 0) return { count: 0, lagMs };
  const { error: ie } = await supabase.from("raw_signals").insert(rawSignals);
  if (ie) throw ie;
  return { count: rawSignals.length, lagMs };
}

// ── 3. sector_trends → market_signals ────────────────────────────────────────
// Fans out to all profiles. Dedup: source_description = "otx_trend:{id}:{bpId}"

async function syncSectorTrends(profiles: QEProfile[]): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data: existing } = await supabase
    .from("market_signals")
    .select("source_description")
    .like("source_description", "otx_trend:%");

  const synced = new Set(
    (existing ?? []).map((r: { source_description: string | null }) => r.source_description ?? ""),
  );

  const { data, error } = await supabase
    .from("sector_trends")
    .select("id, sector, geo, z_score, spike_detected, detected_at_utc, source_url, confidence_score")
    .order("detected_at_utc", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data?.length) return 0;

  const signals = [];
  for (const r of data as {
    id: string; sector: string; geo: string | null; z_score: number;
    spike_detected: boolean; detected_at_utc: string; source_url: string; confidence_score: number;
  }[]) {
    // Only fan out to profiles whose sector matches the trend's sector
    const matchingProfiles = profiles.filter(p => p.sector === r.sector || p.sector === "local");
    for (const profile of matchingProfiles) {
      const key = `otx_trend:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      const impact = r.z_score >= 3 ? "high" : r.z_score >= 2 ? "medium" : "low";
      signals.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        summary: `מגמה בענף ${r.sector}${r.geo ? ` | ${r.geo}` : ""} | Z=${r.z_score.toFixed(2)}${r.spike_detected ? " 🔺" : ""}`,
        impact_level: impact, category: "trend",
        recommended_action: r.spike_detected ? "שקול פעולת קידום מיידית" : "המשך לעקוב",
        confidence: r.confidence_score, source_urls: r.source_url,
        is_read: false, detected_at: r.detected_at_utc,
        data_freshness: "live", source_description: key,
      });
    }
  }

  if (signals.length === 0) return 0;
  const { error: ie } = await supabase.from("market_signals").insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 4. competitor_changes → market_signals ────────────────────────────────────
// Dedup: source_description = "otx_comp:{id}:{bpId}"
// Only fans out to QE profiles whose sector matches the OTX source business.

async function syncCompetitorChanges(profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data: existing } = await supabase
    .from("market_signals")
    .select("source_description")
    .like("source_description", "otx_comp:%");

  const synced = new Set(
    (existing ?? []).map((r: { source_description: string | null }) => r.source_description ?? ""),
  );

  const { data, error } = await supabase
    .from("competitor_changes")
    .select("id, business_id, competitor_name, change_type, change_summary, detected_at_utc, source_url, confidence_score")
    .order("detected_at_utc", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data?.length) return 0;

  const typeHeb: Record<string, string> = {
    price: "שינוי מחיר", website: "שינוי אתר", social: "פוסט חדש", reviews: "שינוי ביקורות",
  };

  const signals = [];
  for (const r of data as {
    id: string; business_id: string; competitor_name: string | null;
    change_type: string | null; change_summary: string | null;
    detected_at_utc: string; source_url: string; confidence_score: number;
  }[]) {
    const otxSector = bizSectors.get(r.business_id) ?? "local";
    const targetProfiles = profilesForSector(profiles, otxSector);
    for (const profile of targetProfiles) {
      const key = `otx_comp:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      signals.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        summary: `${r.competitor_name ?? "מתחרה"} — ${typeHeb[r.change_type ?? ""] ?? "שינוי"}: ${(r.change_summary ?? "").slice(0, 200)}`,
        impact_level: "medium", category: "competitor_move",
        recommended_action: "בדוק את השינוי ושקול תגובה",
        confidence: r.confidence_score, source_urls: r.source_url,
        is_read: false, detected_at: r.detected_at_utc,
        data_freshness: "live", source_description: key,
      });
    }
  }

  if (signals.length === 0) return 0;
  const { error: ie } = await supabase.from("market_signals").insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 5. event_opportunities → market_signals ──────────────────────────────────
// KAN-191: maps to event/local_event taxonomy; enforces date gate + provenance.

async function syncEventOpportunities(profiles: QEProfile[]): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data: existing } = await supabase
    .from("market_signals")
    .select("source_description")
    .like("source_description", "%otx_event:%");

  const synced = new Set(
    (existing ?? []).map((r: { source_description: string | null }) => {
      const raw = r.source_description ?? "";
      try { return (JSON.parse(raw) as { _dedup_key?: string })?._dedup_key ?? raw; } catch { return raw; }
    }),
  );

  const now = Date.now();
  // AC3: raise quality floor from 0.25 → 0.5 to match Express quality gate
  const { data, error } = await supabase
    .from("event_opportunities")
    .select(`id, business_id, impact_score, source_url, confidence_score,
             events_raw!inner ( event_name, event_date, geo )`)
    .gte("impact_score", 0.5)
    .order("impact_score", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data?.length) return 0;

  const signals = [];
  for (const r of data as {
    id: string; business_id: string; impact_score: number;
    source_url: string; confidence_score: number;
    events_raw: { event_name: string; event_date: string; geo: string | null };
  }[]) {
    // AC2 + AC4: skip rows with no confirmed date or past events
    const eventDate = r.events_raw?.event_date ?? null;
    if (!eventDate) continue;
    const eventMs = new Date(eventDate).getTime();
    if (!Number.isFinite(eventMs) || eventMs < now - 86_400_000) continue;

    for (const profile of profiles) {
      const key = `otx_event:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      // AC1: geo present → local_event; otherwise → event
      const category = r.events_raw?.geo ? "local_event" : "event";
      signals.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        agent_name: r.events_raw.event_name,
        summary: `${r.events_raw.event_name} (${eventDate}) | ציון ${Math.round(r.impact_score * 100)}%`,
        impact_level: r.impact_score >= 0.7 ? "high" : "medium",
        category,
        recommended_action: "שקול פעולת קידום לקראת האירוע",
        confidence: r.confidence_score, source_urls: r.source_url,
        source_signals: "otx_engine", // AC3: provenance
        is_read: false, detected_at: new Date().toISOString(),
        data_freshness: "live",
        // AC3: store event metadata so getEventMeta() on the FE can read event_date
        source_description: JSON.stringify({ _dedup_key: key, event_date: eventDate, event_name: r.events_raw.event_name, event_type: category }),
      });
    }
  }

  if (signals.length === 0) return 0;
  const { error: ie } = await supabase.from("market_signals").insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 6. actions_recommended → proactive_alerts ────────────────────────────────
// Dedup: description starts with "otx_action_id:{id}:{bpId}"
// Only fans out to QE profiles whose sector matches the OTX source business.

async function syncActions(profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data: existing } = await supabase
    .from("proactive_alerts")
    .select("description")
    .eq("source_agent", "OTXEngine")
    .like("description", "otx_action_id:%");

  const synced = new Set(
    (existing ?? []).map((r: { description: string | null }) => r.description ?? ""),
  );

  const { data, error } = await supabase
    .from("actions_recommended")
    .select("id, business_id, action_type, action_score, stale_memory_flag, source_url, confidence_score, expires_at, created_at")
    .gt("expires_at", new Date().toISOString())
    .order("action_score", { ascending: false })
    .limit(20);

  if (error) throw error;
  if (!data?.length) return 0;

  const typeHeb: Record<string, string> = {
    promote: "קדם עכשיו", respond: "הגב ללידים", alert: "התראת מתחרה", hold: "המתן",
  };
  const priorityMap: Record<string, string> = {
    promote: "high", respond: "high", alert: "critical", hold: "low",
  };

  const alerts = [];
  for (const r of data as {
    id: string; business_id: string; action_type: string; action_score: number;
    stale_memory_flag: boolean; source_url: string; confidence_score: number;
    expires_at: string; created_at: string;
  }[]) {
    const otxSector = bizSectors.get(r.business_id) ?? "local";
    const targetProfiles = profilesForSector(profiles, otxSector);
    for (const profile of targetProfiles) {
      const descKey = `otx_action_id:${r.id}:${profile.id}`;
      if (synced.has(descKey)) continue;
      const staleNote = r.stale_memory_flag ? " ⚠ זיכרון ישן" : "";
      alerts.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        alert_type: r.action_type,
        title: `OTX: ${typeHeb[r.action_type] ?? r.action_type} | ${Math.round(r.action_score * 100)}%${staleNote}`,
        description: descKey,
        suggested_action: typeHeb[r.action_type] ?? r.action_type,
        action_url: r.source_url,
        priority: priorityMap[r.action_type] ?? "medium",
        source_agent: "OTXEngine",
        is_dismissed: false, is_acted_on: false,
        created_at: r.created_at,
      });
    }
  }

  if (alerts.length === 0) return 0;
  const { error: ie } = await supabase.from("proactive_alerts").insert(alerts);
  if (ie) throw ie;
  return alerts.length;
}

// ── 7. agent_heartbeat → automation_logs ─────────────────────────────────────

async function syncHeartbeats(profiles: QEProfile[]): Promise<number> {
  if (profiles.length === 0) return 0;

  const { data, error } = await supabase
    .from("agent_heartbeat")
    .select("agent_name, last_ping_utc, last_ingestion_utc, status, error_message")
    .order("last_ping_utc", { ascending: false })
    .limit(20);

  if (error) throw error;

  const latest = new Map<string, typeof data[0]>();
  for (const r of (data ?? [])) {
    if (!latest.has(r.agent_name)) latest.set(r.agent_name, r);
  }

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const logs = [];

  for (const profile of profiles) {
    const { data: recentLogs } = await supabase
      .from("automation_logs")
      .select("automation_name")
      .eq("linked_business", profile.id)
      .gte("start_time", cutoff);

    const recentNames = new Set((recentLogs ?? []).map((r: { automation_name: string }) => r.automation_name));

    for (const [name, r] of latest.entries()) {
      if (recentNames.has(`OTX:${name}`)) continue;
      logs.push({
        id: uid(), created_by: profile.created_by, linked_business: profile.id,
        automation_name: `OTX:${name}`,
        start_time: r.last_ingestion_utc ?? r.last_ping_utc,
        end_time: r.last_ping_utc,
        status: r.status === "OK" ? "success" : r.status === "DELAYED" ? "warning" : "error",
        items_processed: 1,
        error_message: r.error_message ?? null,
      });
    }
  }

  if (logs.length === 0) return 0;
  const { error: ie } = await supabase.from("automation_logs").insert(logs);
  if (ie) throw ie;
  return logs.length;
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting sync at ${new Date().toISOString()}`);

  const [profiles, bizSectors] = await Promise.all([fetchQEProfiles(), fetchOTXBusinessSectors()]);
  console.log(`[${AGENT_NAME}] Syncing to ${profiles.length} business profiles, ${bizSectors.size} OTX businesses`);

  // Clean up any cross-sector contamination from previous runs
  await cleanContaminatedData(profiles, bizSectors).catch((e: Error) => {
    console.error(`[${AGENT_NAME}] cleanup failed:`, e.message);
  });

  const results: Record<string, number> = {};
  const errors: string[] = [];
  let rawSignalLagMs: number | null = null;

  const tasks: [string, () => Promise<number>][] = [
    ["leads",        () => syncLeads(profiles, bizSectors)],
    ["raw_signals",  async () => { const r = await syncRawSignals(profiles, bizSectors); rawSignalLagMs = r.lagMs; return r.count; }],
    ["trends",       () => syncSectorTrends(profiles)],
    ["comp_changes", () => syncCompetitorChanges(profiles, bizSectors)],
    ["event_opps",   () => syncEventOpportunities(profiles)],
    ["actions",      () => syncActions(profiles, bizSectors)],
    ["heartbeats",   () => syncHeartbeats(profiles)],
  ];

  for (const [name, fn] of tasks) {
    await fn()
      .then((n) => { results[name] = n; })
      .catch((e: Error) => {
        errors.push(`${name}: ${e.message}`);
        console.error(`[${AGENT_NAME}] ${name} failed:`, e.message);
      });
  }

  // AC3b + AC5: flag lag > 60s as DELAYED
  const lagExceeded = rawSignalLagMs !== null && rawSignalLagMs > 60_000;
  if (rawSignalLagMs !== null) {
    console.log(`[${AGENT_NAME}] signals_raw→RawSignal lag=${Math.round(rawSignalLagMs / 1000)}s (limit=60s)${lagExceeded ? " ⚠ EXCEEDED" : ""}`);
  }

  // AC5: duplicate-vs-Express rate — OTX-sourced leads vs total
  const [otxLeadsRes, totalLeadsRes] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("source_origin", "otx_engine"),
    supabase.from("leads").select("id", { count: "exact", head: true }),
  ]);
  const otxCount = otxLeadsRes.count ?? 0;
  const totalCount = totalLeadsRes.count ?? 0;
  const dupRate = totalCount > 0 ? `${((otxCount / totalCount) * 100).toFixed(1)}%` : "n/a";
  console.log(`[${AGENT_NAME}] leads: ${otxCount} OTX / ${totalCount} total (${dupRate} otx-vs-express rate)`);

  const totalSynced = Object.values(results).reduce((a, b) => a + b, 0);
  const now = new Date().toISOString();
  const hasError = errors.length > 0 || lagExceeded;
  const errorMsg = [
    ...errors,
    ...(lagExceeded ? [`lag ${Math.round(rawSignalLagMs! / 1000)}s > 60s`] : []),
  ].join(" | ") || undefined;
  await pingHeartbeat(AGENT_NAME, hasError ? "DELAYED" : "OK", now, errorMsg);

  console.log(`[${AGENT_NAME}] Done. ${totalSynced} records synced:`, results,
    errors.length ? `\nErrors: ${errors.join(", ")}` : "");
}

// deno-lint-ignore no-explicit-any
export async function runOtxSyncBridge(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
