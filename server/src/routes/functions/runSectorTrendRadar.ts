// OTX SectorTrendRadar — Node.js port of agents/sector_trend_radar.ts
// Wired into the Express scheduler's 0 * * * * cron. Reads signals_raw, writes sector_trends + agent_data_bus.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('SectorTrendRadar');
const AGENT_NAME  = 'SectorTrendRadar';
const Z_THRESHOLD = parseFloat(process.env.Z_THRESHOLD ?? '2.0');
const MIN_SAMPLES = 10;
const MAX_LAG_MS  = 300_000;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface SignalVolume  { sector: string; geo: string | null; hour_bucket: string; volume: number }
interface SectorGeoGroup { sector: string; geo: string | null; volumeHistory: number[]; currentVolume: number }
interface SectorTrendRow {
  sector: string; geo: string | null; z_score: number;
  rolling_mean: number; rolling_std: number; spike_detected: boolean;
  detected_at_utc: string; source_url: string; confidence_score: number;
}

// ─── Z-score ──────────────────────────────────────────────────────────────────

function computeZScore(current: number, mean: number, std: number): number {
  if (std < 0.0001) return 0;
  return (current - mean) / std;
}

function rollingStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function pingHeartbeat(
  status: 'OK' | 'DELAYED' | 'ERROR',
  lastIngestionUtc?: string,
  errorMessage?: string,
) {
  const { error } = await getSupabaseOTX().from('agent_heartbeat').insert({
    agent_name: AGENT_NAME, last_ping_utc: new Date().toISOString(),
    last_ingestion_utc: lastIngestionUtc ?? null, status, error_message: errorMessage ?? null,
  });
  if (error) logger.warn(`heartbeat insert failed: ${error.message}`);
}

const CITY_HEBREW: Record<string, string> = {
  tel_aviv: 'תל אביב', bnei_brak: 'בני ברק', jerusalem: 'ירושלים',
  haifa: 'חיפה', beer_sheva: 'באר שבע', ramat_gan: 'רמת גן',
  petah_tikva: 'פתח תקווה', herzliya: 'הרצליה', raanana: 'רעננה',
};
const SECTOR_HEBREW: Record<string, string> = {
  restaurant: 'מסעדה אוכל', fitness: 'חדר כושר ספורט',
  beauty: 'יופי ספא', local: 'עסק מקומי',
};

async function fetchSpikeArticleUrl(sector: string, geo: string | null, tavilyKey: string): Promise<string | null> {
  const cityName   = geo ? (CITY_HEBREW[geo] ?? geo.replace(/_/g, ' ')) : 'ישראל';
  const sectorName = SECTOR_HEBREW[sector] ?? sector;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query: `${sectorName} ${cityName} מגמה עדכון`, search_depth: 'basic', max_results: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.results?.[0]?.url ?? null;
  } catch { return null; }
}

function buildTrendsUrl(sector: string, geo: string | null): string {
  const query = encodeURIComponent(`${sector} ${geo ?? 'israel'} trend`);
  return `https://trends.google.com/trends/explore?q=${query}&geo=IL`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runSectorTrendRadar(): Promise<void> {
  const runStart = Date.now();
  logger.info(`${AGENT_NAME}: starting run`);

  const supabase   = getSupabaseOTX();
  const tavilyKey  = process.env.TAVILY_API_KEY;
  const since      = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // 1. Fetch signal volumes from the last 48h
  const { data: rawData, error: fetchErr } = await supabase
    .from('signals_raw')
    .select('business_id, geo, detected_at_utc, businesses!inner(sector)')
    .gte('detected_at_utc', since)
    .order('detected_at_utc', { ascending: true });

  if (fetchErr) {
    await pingHeartbeat('ERROR', undefined, fetchErr.message);
    return;
  }
  if (!rawData?.length) {
    logger.info(`${AGENT_NAME}: no signal data — nothing to score`);
    await pingHeartbeat('OK');
    return;
  }

  // 2. Aggregate into hourly volumes per sector+geo
  const volumeMap = new Map<string, SignalVolume>();
  for (const row of rawData as any[]) {
    const sector: string      = (row.businesses as any).sector;
    const geo: string | null  = row.geo ?? null;
    const d                   = new Date(row.detected_at_utc as string);
    const hourBucket = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
    const key = `${sector}|${geo ?? 'all'}|${hourBucket}`;
    const existing = volumeMap.get(key);
    if (existing) existing.volume++;
    else volumeMap.set(key, { sector, geo, hour_bucket: hourBucket, volume: 1 });
  }

  // 3. Group into rolling windows per sector+geo
  const groupMap = new Map<string, SignalVolume[]>();
  for (const v of volumeMap.values()) {
    const key = `${v.sector}|${v.geo ?? 'all'}`;
    const arr = groupMap.get(key) ?? [];
    arr.push(v);
    groupMap.set(key, arr);
  }

  const groups: SectorGeoGroup[] = [];
  for (const [key, vols] of groupMap.entries()) {
    const sorted = vols.sort((a, b) => a.hour_bucket.localeCompare(b.hour_bucket));
    const [sector, geoStr] = key.split('|');
    groups.push({
      sector,
      geo:           geoStr === 'all' ? null : geoStr,
      volumeHistory: sorted.slice(0, -1).map(v => v.volume),
      currentVolume: sorted[sorted.length - 1]?.volume ?? 0,
    });
  }

  // 4. Compute z-scores and build rows
  const now  = new Date().toISOString();
  const rows: SectorTrendRow[] = [];

  for (const group of groups) {
    const { mean, std }        = rollingStats(group.volumeHistory);
    const hasSufficientSamples = group.volumeHistory.length >= MIN_SAMPLES;
    const z                    = hasSufficientSamples ? computeZScore(group.currentVolume, mean, std) : 0;
    const spikeDetected        = hasSufficientSamples && z > Z_THRESHOLD;
    const confidenceScore      = hasSufficientSamples
      ? Math.min(0.5 + (group.volumeHistory.length / 48) * 0.4, 0.95)
      : 0.4;

    let sourceUrl: string;
    if (spikeDetected && tavilyKey) {
      sourceUrl = (await fetchSpikeArticleUrl(group.sector, group.geo, tavilyKey)) ?? buildTrendsUrl(group.sector, group.geo);
    } else {
      sourceUrl = buildTrendsUrl(group.sector, group.geo);
    }

    rows.push({
      sector:           group.sector,
      geo:              group.geo,
      z_score:          Math.round(z * 100) / 100,
      rolling_mean:     Math.round(mean * 100) / 100,
      rolling_std:      Math.round(std * 100) / 100,
      spike_detected:   spikeDetected,
      detected_at_utc:  now,
      source_url:       sourceUrl,
      confidence_score: Math.round(confidenceScore * 100) / 100,
    });

    if (spikeDetected) {
      logger.info(`${AGENT_NAME}: SPIKE sector=${group.sector} geo=${group.geo} z=${z.toFixed(2)} vol=${group.currentVolume} mean=${mean.toFixed(2)}`);
    }
  }

  if (rows.length === 0) {
    await pingHeartbeat('OK');
    return;
  }

  // 5. Insert sector_trends
  const { error: insertErr } = await supabase.from('sector_trends').insert(rows);
  if (insertErr) {
    logger.error(`${AGENT_NAME}: insert failed: ${insertErr.message}`);
    await pingHeartbeat('ERROR', undefined, insertErr.message);
    return;
  }

  // 6. Publish trend_spike events to agent_data_bus for each spiking sector × affected business
  const spikeRows = rows.filter(r => r.spike_detected);
  if (spikeRows.length > 0) {
    const { data: businesses } = await supabase.from('businesses').select('id, sector, geo_city');
    const bizList = (businesses ?? []) as Array<{ id: string; sector: string; geo_city: string }>;

    const busEvents: any[] = [];
    for (const spike of spikeRows) {
      const affectedIds = bizList
        .filter(b => b.sector === spike.sector && (spike.geo === null || b.geo_city === spike.geo))
        .map(b => b.id);
      for (const businessId of affectedIds) {
        const priority     = spike.z_score > 3.0 ? 1 : 5;
        const targetAgents = ['InfluenceIntegrityAuditor', 'CrossSectorBridgeAgent', 'ResourceArbitrageAgent'];
        if (spike.z_score > 2.5) targetAgents.push('ViralCatalyst');
        if (spike.z_score > 2.0) targetAgents.push('ActionScoringService');
        busEvents.push({
          business_id:      businessId,
          source_agent:     AGENT_NAME,
          source_record_id: crypto.randomUUID(),
          source_table:     'sector_trends',
          event_type:       'trend_spike',
          payload:          { sector: spike.sector, geo: spike.geo, z_score: spike.z_score, confidence_score: spike.confidence_score, source_url: spike.source_url },
          priority,
          target_agents:    targetAgents,
          consumed_by:      [],
          expires_at:       new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          processed:        false,
        });
      }
    }

    if (busEvents.length > 0) {
      const { error: busErr } = await supabase.from('agent_data_bus').insert(busEvents);
      if (busErr) logger.warn(`${AGENT_NAME}: bus publish failed: ${busErr.message}`);
      else logger.info(`${AGENT_NAME}: published ${busEvents.length} trend_spike event(s)`);
    }
  }

  const elapsed = Date.now() - runStart;
  const spikes  = spikeRows.length;
  const status  = elapsed > MAX_LAG_MS ? 'DELAYED' : 'OK';
  await pingHeartbeat(status, now);
  logger.info(`${AGENT_NAME}: done. rows=${rows.length} spikes=${spikes} elapsed=${Math.round(elapsed / 1000)}s status=${status}`);
}
