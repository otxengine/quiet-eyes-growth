// OTXSyncBridge — Node.js port of agents/otx_sync_bridge.ts
// Wired into the Express scheduler's */10 cron. Reads OTX schema → writes QE tables.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('OTXSyncBridge');
const AGENT_NAME = 'OTXSyncBridge';

interface QEProfile { id: string; created_by: string; sector: string }
type Supa = ReturnType<typeof getSupabaseOTX>;

const CATEGORY_TO_SECTOR: Record<string, string> = {
  'מסעדה': 'restaurant', 'בית קפה': 'restaurant', 'פיצרייה': 'restaurant',
  'פלאפל': 'restaurant', 'שווארמה': 'restaurant', 'קייטרינג': 'restaurant',
  'מכון כושר': 'fitness', 'סטודיו ליוגה': 'fitness', 'סטודיו לפילאטיס': 'fitness',
  'חנות ספורט': 'fitness',
  'מספרה': 'beauty', 'מכון יופי': 'beauty', 'אופטיקה': 'beauty',
};

function categoryToSector(cat: string): string { return CATEGORY_TO_SECTOR[cat] ?? 'local'; }

function profilesForSector(profiles: QEProfile[], otxSector: string): QEProfile[] {
  return profiles.filter(p => p.sector === otxSector || p.sector === 'local');
}

async function fetchQEProfiles(s: Supa): Promise<QEProfile[]> {
  const { data, error } = await s.from('business_profiles').select('id, created_by, category').not('created_by', 'is', null);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, created_by: r.created_by, sector: categoryToSector(r.category ?? '') }));
}

async function fetchOTXBusinessSectors(s: Supa): Promise<Map<string, string>> {
  const { data, error } = await s.from('businesses').select('id, sector');
  if (error) throw error;
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; sector: string }[]) m.set(r.id, r.sector);
  return m;
}

// AC4: cleans leads, raw_signals, AND market_signals (trends + comp_changes)
async function cleanContaminatedData(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<void> {
  const nonLocal = profiles.filter(p => p.sector !== 'local');
  if (nonLocal.length === 0) return;

  const [{ data: clSigs }, { data: rawSigs }, { data: compChanges }, { data: sectorTrends }] = await Promise.all([
    s.from('classified_signals').select('id, business_id'),
    s.from('signals_raw').select('signal_id, business_id'),
    s.from('competitor_changes').select('id, business_id'),
    s.from('sector_trends').select('id, sector'),
  ]);

  const signalSector = new Map<string, string>();
  for (const r of (clSigs ?? []) as { id: string; business_id: string }[]) {
    const sec = bizSectors.get(r.business_id); if (sec) signalSector.set(r.id, sec);
  }
  const rawSector = new Map<string, string>();
  for (const r of (rawSigs ?? []) as { signal_id: string; business_id: string }[]) {
    const sec = bizSectors.get(r.business_id); if (sec) rawSector.set(r.signal_id, sec);
  }
  const compSector = new Map<string, string>();
  for (const r of (compChanges ?? []) as { id: string; business_id: string }[]) {
    const sec = bizSectors.get(r.business_id); if (sec) compSector.set(r.id, sec);
  }
  const trendSector = new Map<string, string>();
  for (const r of (sectorTrends ?? []) as { id: string; sector: string }[]) trendSector.set(r.id, r.sector);

  for (const profile of nonLocal) {
    // leads
    const { data: leads } = await s.from('leads').select('id, source_description')
      .eq('linked_business', profile.id).eq('source_origin', 'otx_engine').like('source_description', 'otx_sig:%');
    const badLeads = (leads ?? []).filter((l: any) => {
      const src = signalSector.get((l.source_description ?? '').split(':')[1]);
      return src && src !== profile.sector;
    }).map((l: any) => l.id);
    if (badLeads.length) {
      await s.from('leads').delete().in('id', badLeads);
      logger.info(`Cleanup: ${badLeads.length} contaminated leads removed from profile ${profile.id}`);
    }

    // raw_signals
    const { data: rawSig } = await s.from('raw_signals').select('id, checksum_hash')
      .eq('linked_business', profile.id).eq('source_origin', 'otx_engine').like('checksum_hash', 'otx:%');
    const badRaw = (rawSig ?? []).filter((r: any) => {
      const src = rawSector.get((r.checksum_hash ?? '').split(':')[1]);
      return src && src !== profile.sector;
    }).map((r: any) => r.id);
    if (badRaw.length) {
      await s.from('raw_signals').delete().in('id', badRaw);
      logger.info(`Cleanup: ${badRaw.length} contaminated raw_signals removed from profile ${profile.id}`);
    }

    // market_signals: trends (otx_trend:{id}) and comp_changes (otx_comp:{id})
    // event_opps fan out to all profiles, so they are never sector-contaminated
    const { data: mktSig } = await s.from('market_signals').select('id, source_description')
      .eq('linked_business', profile.id)
      .or('source_description.like.otx_trend:%,source_description.like.otx_comp:%');
    const badMkt = (mktSig ?? []).filter((m: any) => {
      const desc: string = m.source_description ?? '';
      if (desc.startsWith('otx_trend:')) {
        const src = trendSector.get(desc.split(':')[1]);
        return src && src !== profile.sector;
      }
      if (desc.startsWith('otx_comp:')) {
        const src = compSector.get(desc.split(':')[1]);
        return src && src !== profile.sector;
      }
      return false;
    }).map((m: any) => m.id);
    if (badMkt.length) {
      await s.from('market_signals').delete().in('id', badMkt);
      logger.info(`Cleanup: ${badMkt.length} contaminated market_signals removed from profile ${profile.id}`);
    }
  }
}

// ── 1. classified_signals → leads ─────────────────────────────────────────────

async function syncLeads(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (!profiles.length) return 0;
  const { data: existing } = await s.from('leads').select('source_description').like('source_description', 'otx_sig:%');
  const synced = new Set((existing ?? []).map((r: any) => r.source_description ?? ''));

  const { data, error } = await s.from('classified_signals')
    .select('id, business_id, intent_score, geo_match_score, sector_match_score, source_url, confidence_score, processed_at')
    .eq('qualified', true).order('processed_at', { ascending: false }).limit(50);
  if (error) throw error;
  if (!data?.length) return 0;

  const leads: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profilesForSector(profiles, bizSectors.get(r.business_id) ?? 'local')) {
      const key = `otx_sig:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      const score = Math.round((0.5 * r.intent_score + 0.3 * r.sector_match_score + 0.2 * r.geo_match_score) * 100);
      let hostname = r.source_url;
      try { hostname = new URL(r.source_url).hostname; } catch { /* keep raw */ }
      leads.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        name: `ליד OTX | ${hostname}`, source: 'otx_engine', score,
        status: score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'new',
        intent_source: r.source_url,
        intent_strength: r.intent_score >= 0.85 ? 'high' : r.intent_score >= 0.7 ? 'medium' : 'low',
        source_url: r.source_url, source_origin: 'otx_engine', source_description: key,
        discovery_method: 'otx_signal', freshness_score: 100,
        discovered_at: r.processed_at, created_at: r.processed_at, lifecycle_stage: 'new',
      });
    }
  }
  if (!leads.length) return 0;
  const { error: ie } = await s.from('leads').insert(leads);
  if (ie) throw ie;
  return leads.length;
}

// ── 2. signals_raw → raw_signals ──────────────────────────────────────────────

async function syncRawSignals(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<{ count: number; lagMs: number | null }> {
  if (!profiles.length) return { count: 0, lagMs: null };
  const { data: existing } = await s.from('raw_signals').select('checksum_hash').like('checksum_hash', 'otx:%');
  const synced = new Set((existing ?? []).map((r: any) => r.checksum_hash ?? ''));

  const { data, error } = await s.from('signals_raw')
    .select('signal_id, business_id, source_type, source_url, raw_text, geo, detected_at_utc, confidence_score')
    .order('detected_at_utc', { ascending: false }).limit(50);
  if (error) throw error;
  if (!data?.length) return { count: 0, lagMs: null };

  // AC5: lag = distance from oldest fetched signal_raw to now
  const oldestTs = Math.min(...(data as any[]).map((r: any) => Date.parse(r.detected_at_utc)));
  const lagMs = Number.isFinite(oldestTs) ? Date.now() - oldestTs : null;

  const typeMap: Record<string, string> = { social: 'social_mention', forum: 'social_mention', trend: 'social_trend' };
  const rawSignals: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profilesForSector(profiles, bizSectors.get(r.business_id) ?? 'local')) {
      const key = `otx:${r.signal_id}:${profile.id}`;
      if (synced.has(key)) continue;
      rawSignals.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        source: r.source_url, content: r.raw_text.slice(0, 2000), url: r.source_url,
        signal_type: typeMap[r.source_type] ?? 'social_mention', platform: r.source_type,
        sentiment: 'unknown', checksum_hash: key, detected_at: r.detected_at_utc,
        source_origin: 'otx_engine',
      });
    }
  }
  if (!rawSignals.length) return { count: 0, lagMs };
  const { error: ie } = await s.from('raw_signals').insert(rawSignals);
  if (ie) throw ie;
  return { count: rawSignals.length, lagMs };
}

// ── 3. sector_trends → market_signals ─────────────────────────────────────────

async function syncSectorTrends(s: Supa, profiles: QEProfile[]): Promise<number> {
  if (!profiles.length) return 0;
  const { data: existing } = await s.from('market_signals').select('source_description').like('source_description', 'otx_trend:%');
  const synced = new Set((existing ?? []).map((r: any) => r.source_description ?? ''));

  const { data, error } = await s.from('sector_trends')
    .select('id, sector, geo, z_score, spike_detected, detected_at_utc, source_url, confidence_score')
    .order('detected_at_utc', { ascending: false }).limit(50);
  if (error) throw error;
  if (!data?.length) return 0;

  const signals: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profiles.filter(p => p.sector === r.sector || p.sector === 'local')) {
      const key = `otx_trend:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      const impact = r.z_score >= 3 ? 'high' : r.z_score >= 2 ? 'medium' : 'low';
      signals.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        summary: `מגמה בענף ${r.sector}${r.geo ? ` | ${r.geo}` : ''} | Z=${r.z_score.toFixed(2)}${r.spike_detected ? ' 🔺' : ''}`,
        impact_level: impact, category: 'trend',
        recommended_action: r.spike_detected ? 'שקול פעולת קידום מיידית' : 'המשך לעקוב',
        confidence: r.confidence_score, source_urls: r.source_url,
        is_read: false, detected_at: r.detected_at_utc, data_freshness: 'live', source_description: key,
      });
    }
  }
  if (!signals.length) return 0;
  const { error: ie } = await s.from('market_signals').insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 4. competitor_changes → market_signals ────────────────────────────────────

async function syncCompetitorChanges(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (!profiles.length) return 0;
  const { data: existing } = await s.from('market_signals').select('source_description').like('source_description', 'otx_comp:%');
  const synced = new Set((existing ?? []).map((r: any) => r.source_description ?? ''));

  const { data, error } = await s.from('competitor_changes')
    .select('id, business_id, competitor_name, change_type, change_summary, detected_at_utc, source_url, confidence_score')
    .order('detected_at_utc', { ascending: false }).limit(50);
  if (error) throw error;
  if (!data?.length) return 0;

  const typeHeb: Record<string, string> = { price: 'שינוי מחיר', website: 'שינוי אתר', social: 'פוסט חדש', reviews: 'שינוי ביקורות' };
  const signals: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profilesForSector(profiles, bizSectors.get(r.business_id) ?? 'local')) {
      const key = `otx_comp:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      signals.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        summary: `${r.competitor_name ?? 'מתחרה'} — ${typeHeb[r.change_type ?? ''] ?? 'שינוי'}: ${(r.change_summary ?? '').slice(0, 200)}`,
        impact_level: 'medium', category: 'competitor_move',
        recommended_action: 'בדוק את השינוי ושקול תגובה',
        confidence: r.confidence_score, source_urls: r.source_url,
        is_read: false, detected_at: r.detected_at_utc, data_freshness: 'live', source_description: key,
      });
    }
  }
  if (!signals.length) return 0;
  const { error: ie } = await s.from('market_signals').insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 5. event_opportunities → market_signals ───────────────────────────────────

async function syncEventOpportunities(s: Supa, profiles: QEProfile[]): Promise<number> {
  if (!profiles.length) return 0;
  const { data: existing } = await s.from('market_signals').select('source_description').like('source_description', 'otx_event:%');
  const synced = new Set((existing ?? []).map((r: any) => r.source_description ?? ''));

  const { data, error } = await s.from('event_opportunities')
    .select('id, business_id, impact_score, source_url, confidence_score, events_raw!inner(event_name, event_date, geo)')
    .gt('impact_score', 0.25).order('impact_score', { ascending: false }).limit(50);
  if (error) throw error;
  if (!data?.length) return 0;

  const signals: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profiles) {
      const key = `otx_event:${r.id}:${profile.id}`;
      if (synced.has(key)) continue;
      signals.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        summary: `הזדמנות: ${r.events_raw.event_name} (${r.events_raw.event_date}) | ציון ${Math.round(r.impact_score * 100)}%`,
        impact_level: r.impact_score >= 0.7 ? 'high' : r.impact_score >= 0.5 ? 'medium' : 'low',
        category: 'opportunity', recommended_action: 'שקול פעולת קידום לקראת האירוע',
        confidence: r.confidence_score, source_urls: r.source_url,
        is_read: false, detected_at: new Date().toISOString(), data_freshness: 'live', source_description: key,
      });
    }
  }
  if (!signals.length) return 0;
  const { error: ie } = await s.from('market_signals').insert(signals);
  if (ie) throw ie;
  return signals.length;
}

// ── 6. actions_recommended → proactive_alerts ─────────────────────────────────

async function syncActions(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<number> {
  if (!profiles.length) return 0;
  const { data: existing } = await s.from('proactive_alerts').select('description')
    .eq('source_agent', 'OTXEngine').like('description', 'otx_action_id:%');
  const synced = new Set((existing ?? []).map((r: any) => r.description ?? ''));

  const { data, error } = await s.from('actions_recommended')
    .select('id, business_id, action_type, action_score, stale_memory_flag, source_url, confidence_score, expires_at, created_at')
    .gt('expires_at', new Date().toISOString()).order('action_score', { ascending: false }).limit(20);
  if (error) throw error;
  if (!data?.length) return 0;

  const typeHeb: Record<string, string> = { promote: 'קדם עכשיו', respond: 'הגב ללידים', alert: 'התראת מתחרה', hold: 'המתן' };
  const priorityMap: Record<string, string> = { promote: 'high', respond: 'high', alert: 'critical', hold: 'low' };
  const alerts: any[] = [];
  for (const r of data as any[]) {
    for (const profile of profilesForSector(profiles, bizSectors.get(r.business_id) ?? 'local')) {
      const descKey = `otx_action_id:${r.id}:${profile.id}`;
      if (synced.has(descKey)) continue;
      alerts.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        alert_type: r.action_type,
        title: `OTX: ${typeHeb[r.action_type] ?? r.action_type} | ${Math.round(r.action_score * 100)}%${r.stale_memory_flag ? ' ⚠ זיכרון ישן' : ''}`,
        description: descKey, suggested_action: typeHeb[r.action_type] ?? r.action_type,
        action_url: r.source_url, priority: priorityMap[r.action_type] ?? 'medium',
        source_agent: 'OTXEngine', is_dismissed: false, is_acted_on: false, created_at: r.created_at,
      });
    }
  }
  if (!alerts.length) return 0;
  const { error: ie } = await s.from('proactive_alerts').insert(alerts);
  if (ie) throw ie;
  return alerts.length;
}

// ── 7. agent_heartbeat → automation_logs ──────────────────────────────────────

async function syncHeartbeats(s: Supa, profiles: QEProfile[]): Promise<number> {
  if (!profiles.length) return 0;
  const { data, error } = await s.from('agent_heartbeat')
    .select('agent_name, last_ping_utc, last_ingestion_utc, status, error_message')
    .order('last_ping_utc', { ascending: false }).limit(20);
  if (error) throw error;

  const latest = new Map<string, any>();
  for (const r of (data ?? [])) { if (!latest.has(r.agent_name)) latest.set(r.agent_name, r); }

  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const logs: any[] = [];
  for (const profile of profiles) {
    const { data: recentLogs } = await s.from('automation_logs').select('automation_name')
      .eq('linked_business', profile.id).gte('start_time', cutoff);
    const recentNames = new Set((recentLogs ?? []).map((r: any) => r.automation_name));
    for (const [name, r] of latest.entries()) {
      if (recentNames.has(`OTX:${name}`)) continue;
      logs.push({
        id: crypto.randomUUID(), created_by: profile.created_by, linked_business: profile.id,
        automation_name: `OTX:${name}`, start_time: r.last_ingestion_utc ?? r.last_ping_utc,
        end_time: r.last_ping_utc,
        status: r.status === 'OK' ? 'success' : r.status === 'DELAYED' ? 'warning' : 'error',
        items_processed: 1, error_message: r.error_message ?? null,
      });
    }
  }
  if (!logs.length) return 0;
  const { error: ie } = await s.from('automation_logs').insert(logs);
  if (ie) throw ie;
  return logs.length;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runOTXSyncBridge(): Promise<void> {
  const runStart = Date.now();
  logger.info(`${AGENT_NAME}: starting sync`);
  const s = getSupabaseOTX();

  const [profiles, bizSectors] = await Promise.all([fetchQEProfiles(s), fetchOTXBusinessSectors(s)]);
  logger.info(`${AGENT_NAME}: ${profiles.length} profiles, ${bizSectors.size} OTX businesses`);

  await cleanContaminatedData(s, profiles, bizSectors).catch((e: any) =>
    logger.error(`${AGENT_NAME}: cleanup failed: ${e.message}`),
  );

  const results: Record<string, number> = {};
  const errors: string[] = [];
  let rawSignalLagMs: number | null = null;

  const tasks: [string, () => Promise<number>][] = [
    ['leads',        () => syncLeads(s, profiles, bizSectors)],
    ['raw_signals',  async () => {
      const r = await syncRawSignals(s, profiles, bizSectors);
      rawSignalLagMs = r.lagMs;
      return r.count;
    }],
    ['trends',       () => syncSectorTrends(s, profiles)],
    ['comp_changes', () => syncCompetitorChanges(s, profiles, bizSectors)],
    ['event_opps',   () => syncEventOpportunities(s, profiles)],
    ['actions',      () => syncActions(s, profiles, bizSectors)],
    ['heartbeats',   () => syncHeartbeats(s, profiles)],
  ];

  for (const [name, fn] of tasks) {
    await fn()
      .then((n: number) => { results[name] = n; })
      .catch((e: any) => {
        errors.push(`${name}: ${e.message}`);
        logger.error(`${AGENT_NAME}: ${name} failed: ${e.message}`);
      });
  }

  const totalSynced = Object.values(results).reduce((a, b) => a + b, 0);
  const elapsed = Date.now() - runStart;
  const now = new Date().toISOString();
  const status = errors.length > 0 ? 'DELAYED' : 'OK';

  // AC5: log lag from oldest signals_raw row to visible RawSignal
  if (rawSignalLagMs !== null) {
    logger.info(`${AGENT_NAME}: signals_raw→RawSignal lag=${Math.round(rawSignalLagMs / 1000)}s (limit=600s)`);
  }

  logger.info(`${AGENT_NAME}: done. synced=${totalSynced} elapsed=${Math.round(elapsed / 1000)}s status=${status}`, {
    counts: results,
    ...(errors.length && { errors }),
  });

  const { error: he } = await s.from('agent_heartbeat').insert({
    agent_name: AGENT_NAME, last_ping_utc: now, last_ingestion_utc: now,
    status, error_message: errors.length ? errors.join(' | ') : null,
  });
  if (he) logger.warn(`${AGENT_NAME}: heartbeat failed: ${he.message}`);
}
