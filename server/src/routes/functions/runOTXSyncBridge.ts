// OTXSyncBridge — Node.js port of agents/otx_sync_bridge.ts
// Wired into the Express scheduler's */10 cron. Reads OTX schema → writes QE tables.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('OTXSyncBridge');
const AGENT_NAME = 'OTXSyncBridge';

interface QEProfile { id: string; created_by: string; sector: string }
type Supa = ReturnType<typeof getSupabaseOTX>;

// sector_key taxonomy set on BusinessProfile.sector_profile at approve-about
// (server/src/routes/onboarding.ts) — matches what syncBusinessToOTX writes to
// businesses.sector, so QE profiles and OTX businesses compare on the same space.
export function sectorKeyOf(sectorProfileJson: string | null): string {
  try { return JSON.parse(sectorProfileJson ?? '{}')?.sector_key || 'other'; } catch { return 'other'; }
}

function profilesForSector(profiles: QEProfile[], otxSector: string): QEProfile[] {
  return profiles.filter(p => p.sector === otxSector || p.sector === 'other');
}

async function fetchQEProfiles(s: Supa): Promise<QEProfile[]> {
  const { data, error } = await s.from('business_profiles').select('id, created_by, sector_profile').not('created_by', 'is', null);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, created_by: r.created_by, sector: sectorKeyOf(r.sector_profile) }));
}

async function fetchOTXBusinessSectors(s: Supa): Promise<Map<string, string>> {
  const { data, error } = await s.from('businesses').select('id, sector');
  if (error) throw error;
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; sector: string }[]) m.set(r.id, r.sector);
  return m;
}

// Cleans market_signals sourced from competitor_changes (otx_comp:{id}) —
// the only sync source still backed by a live table. classified_signals,
// signals_raw, and sector_trends were dropped from the schema; their sync
// tasks and contamination checks were removed with them.
export async function cleanContaminatedData(s: Supa, profiles: QEProfile[], bizSectors: Map<string, string>): Promise<void> {
  const classified = profiles.filter(p => p.sector !== 'other');
  if (classified.length === 0) return;

  const { data: compChanges } = await s.from('competitor_changes').select('id, business_id');

  const compSector = new Map<string, string>();
  for (const r of (compChanges ?? []) as { id: string; business_id: string }[]) {
    const sec = bizSectors.get(r.business_id); if (sec) compSector.set(r.id, sec);
  }

  for (const profile of classified) {
    const { data: mktSig } = await s.from('market_signals').select('id, source_description')
      .eq('linked_business', profile.id)
      .like('source_description', 'otx_comp:%');
    const badMkt = (mktSig ?? []).filter((m: any) => {
      const desc: string = m.source_description ?? '';
      const src = compSector.get(desc.split(':')[1]);
      return src && src !== profile.sector;
    }).map((m: any) => m.id);
    if (badMkt.length) {
      await s.from('market_signals').delete().in('id', badMkt);
      logger.info(`Cleanup: ${badMkt.length} contaminated market_signals removed from profile ${profile.id}`);
    }
  }
}

// ── 4. competitor_changes → market_signals ────────────────────────────────────
// Merge point for the dual change pipeline: the OTX leg (collectOTXCompetitorChanges)
// writes to competitor_changes; this function bridges them into market_signals so both
// the Express leg (detectCompetitorChanges) and OTX leg land in the same feed.

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
    for (const profile of profilesForSector(profiles, bizSectors.get(r.business_id) ?? 'other')) {
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

// ── 5. agent_heartbeat → automation_logs ──────────────────────────────────────

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

  const tasks: [string, () => Promise<number>][] = [
    ['comp_changes', () => syncCompetitorChanges(s, profiles, bizSectors)],
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
