// OTX IntentClassification — Node.js port of agents/intent_classification.ts
// AC1 fallback: runs every 5 min via scheduler to catch any signals missed by the bus trigger.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('OTXIntentClassification');
const AGENT_NAME = 'OTXIntentClassification';
const INTENT_THRESHOLD = parseFloat(process.env.INTENT_THRESHOLD ?? '0.65');

// ─── Scoring tables (mirrored from agents/intent_classification.ts) ───────────

const INTENT_KEYWORDS: Record<string, number> = {
  'אני מחפש': 0.9, 'אני צריך': 0.9, 'מישהו ממליץ': 0.85, 'מחפש המלצה': 0.85,
  'איפה אפשר': 0.8, 'כמה עולה': 0.8, 'מחיר': 0.7, 'להזמין': 0.85,
  'looking for': 0.85, recommend: 0.8, price: 0.7, 'how much': 0.75,
  'where can i': 0.8, best: 0.65, need: 0.75, want: 0.7,
  book: 0.85, reserve: 0.85, appointment: 0.9, 'תור': 0.9,
  'חדש': 0.5, new: 0.5, opening: 0.6, 'פתיחה': 0.6,
};

const SECTOR_TERMS: Record<string, string[]> = {
  restaurant: ['מסעדה', 'אוכל', 'שף', 'תפריט', 'restaurant', 'food', 'menu', 'chef', 'eat', 'dinner', 'lunch', 'breakfast', 'pizza', 'burger', 'sushi'],
  fitness:    ['כושר', 'חדר כושר', 'ספורט', 'אימון', 'gym', 'fitness', 'workout', 'sport', 'yoga', 'pilates', 'crossfit', 'marathon', 'run'],
  beauty:     ['יופי', 'ספא', 'תספורת', 'מניקור', 'beauty', 'spa', 'hair', 'nail', 'salon', 'makeup', 'skin', 'facial', 'waxing'],
  local:      ['מקומי', 'שכונה', 'עסק', 'שירות', 'local', 'community', 'service', 'neighborhood', 'area'],
};

const REGION_MAP: Record<string, string> = {
  tel_aviv: 'center', ramat_gan: 'center', givatayim: 'center', bat_yam: 'center',
  bnei_brak: 'center', petah_tikva: 'center', raanana: 'center', herzliya: 'center',
  jerusalem: 'jerusalem', beit_shemesh: 'jerusalem',
  haifa: 'north', krayot: 'north', nahariya: 'north', acre: 'north',
  beer_sheva: 'south', eilat: 'south', ashdod: 'south', ashkelon: 'south',
};

function computeIntentScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let maxScore = 0;
  let matchCount = 0;
  for (const [kw, score] of Object.entries(INTENT_KEYWORDS)) {
    if (lower.includes(kw.toLowerCase())) { maxScore = Math.max(maxScore, score); matchCount++; }
  }
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) { matchCount++; maxScore = Math.max(maxScore, 0.6); }
  }
  return Math.min(maxScore + Math.min(matchCount * 0.05, 0.15), 1.0);
}

function computeSectorMatchScore(text: string, sector: string): number {
  const lower = text.toLowerCase();
  const terms = SECTOR_TERMS[sector] ?? [];
  if (!terms.length) return 0.3;
  const matches = terms.filter(t => lower.includes(t.toLowerCase())).length;
  return Math.min(matches / terms.length * 3, 1.0);
}

function geoScore(signalGeo: string, bizGeo: string): number {
  if (!signalGeo || !bizGeo) return 0.3;
  if (signalGeo.toLowerCase() === bizGeo.toLowerCase()) return 1.0;
  const norm = (g: string) => REGION_MAP[g.toLowerCase().replace(/ /g, '_')];
  const rA = norm(signalGeo);
  const rB = norm(bizGeo);
  return rA && rA === rB ? 0.6 : 0.1;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runOTXIntentClassification(): Promise<void> {
  const s = getSupabaseOTX();
  logger.info(`${AGENT_NAME}: starting`);

  // Load already-processed signal_ids
  const { data: processed } = await s.from('classified_signals').select('signal_id');
  const processedIds = new Set((processed ?? []).map((r: any) => r.signal_id as string));

  // Fetch latest 500 raw signals
  const { data: signals, error } = await s
    .from('signals_raw')
    .select('signal_id, business_id, source_url, raw_text, geo, detected_at_utc, confidence_score')
    .order('detected_at_utc', { ascending: false })
    .limit(500);
  if (error) throw error;

  const unprocessed = (signals ?? []).filter((r: any) => !processedIds.has(r.signal_id));
  if (!unprocessed.length) {
    logger.info(`${AGENT_NAME}: no unprocessed signals`);
    return;
  }

  // Load OTX business profiles (latest per business_id)
  const { data: profileData } = await s
    .from('otx_business_profiles')
    .select('business_id, sector, geo, keywords')
    .order('updated_at', { ascending: false });
  const profiles = new Map<string, any>();
  for (const p of (profileData ?? [])) {
    if (!profiles.has(p.business_id)) profiles.set(p.business_id, p);
  }

  const rows = unprocessed.map((r: any) => {
    const profile = profiles.get(r.business_id);
    const intentScore       = computeIntentScore(r.raw_text ?? '', profile?.keywords ?? []);
    const sectorMatchScore  = computeSectorMatchScore(r.raw_text ?? '', profile?.sector ?? 'local');
    const geoMatchScore     = geoScore(r.geo ?? '', profile?.geo ?? '');
    return {
      signal_id:          r.signal_id,
      business_id:        r.business_id,
      intent_score:       Math.round(intentScore * 100) / 100,
      sector_match_score: Math.round(sectorMatchScore * 100) / 100,
      geo_match_score:    Math.round(geoMatchScore * 100) / 100,
      qualified:          intentScore > INTENT_THRESHOLD,
      processed_at:       new Date().toISOString(),
      source_url:         r.source_url,
      confidence_score:   r.confidence_score,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { error: ie, count } = await s
      .from('classified_signals')
      .insert(rows.slice(i, i + 100), { count: 'exact' });
    if (ie) logger.error(`${AGENT_NAME}: insert chunk failed: ${ie.message}`);
    else inserted += count ?? rows.slice(i, i + 100).length;
  }

  const now = new Date().toISOString();
  const { error: he } = await s.from('agent_heartbeat').insert({
    agent_name: AGENT_NAME, last_ping_utc: now, last_ingestion_utc: now, status: 'OK',
  });
  if (he) logger.warn(`${AGENT_NAME}: heartbeat failed: ${he.message}`);

  logger.info(`${AGENT_NAME}: done. classified=${inserted} qualified=${rows.filter(r => r.qualified).length}`);
}
