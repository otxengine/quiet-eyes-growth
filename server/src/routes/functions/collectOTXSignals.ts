// OTX SignalCollector — Node.js port of agents/signal_collector.ts
// Wired into the Express scheduler's */30 cron. Writes to Supabase OTX schema.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('CollectOTXSignals');
const AGENT_NAME = 'SignalCollector';
const MAX_LAG_MS = 120_000;

const CITY_HEBREW: Record<string, string> = {
  tel_aviv: 'תל אביב', bnei_brak: 'בני ברק', jerusalem: 'ירושלים',
  haifa: 'חיפה', beer_sheva: 'באר שבע', ramat_gan: 'רמת גן',
  petah_tikva: 'פתח תקווה', herzliya: 'הרצליה', raanana: 'רעננה',
  bat_yam: 'בת ים', netanya: 'נתניה', holon: 'חולון',
  ashdod: 'אשדוד', ashkelon: 'אשקלון', rishon_lezion: 'ראשון לציון',
};

const SECTOR_HEBREW: Record<string, string> = {
  restaurant: 'מסעדה אוכל', fitness: 'חדר כושר ספורט',
  beauty: 'יופי ספא תספורת', local: 'עסק מקומי שירות',
};

interface Business { id: string; name: string; sector: string; geo_city: string; price_tier: string | null }
interface RawSignal { business_id: string; source_type: string; source_url: string; raw_text: string; geo: string; detected_at_utc: string; confidence_score: number }

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    await new Promise(r => setTimeout(r, 2_000));
    logger.warn(`${label}: retrying after error: ${e.message}`);
    return fn();
  }
}

async function fetchSerpApi(biz: Business, key: string): Promise<RawSignal[]> {
  const q = encodeURIComponent(`${biz.sector} ${biz.geo_city} ${biz.price_tier ?? ''}`.trim());
  const res = await fetch(`https://serpapi.com/search.json?q=${q}&hl=iw&gl=il&num=10&api_key=${key}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);
  return (data.organic_results ?? []).map((r: any): RawSignal => ({
    business_id: biz.id, source_type: 'trend', source_url: r.link,
    raw_text: `${r.title} — ${r.snippet}`, geo: biz.geo_city,
    detected_at_utc: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    confidence_score: 0.9,
  }));
}

async function fetchReddit(biz: Business): Promise<RawSignal[]> {
  const sub: Record<string, string> = { restaurant: 'food+israelifood', fitness: 'fitness+israelisports', beauty: 'beauty+selfcare', local: 'israel+telaviv' };
  const q = encodeURIComponent(`${biz.geo_city} ${biz.price_tier ?? ''}`);
  const res = await fetch(`https://www.reddit.com/r/${sub[biz.sector] ?? 'israel'}/search.json?q=${q}&sort=new&limit=10&restrict_sr=1`, {
    headers: { 'User-Agent': 'OTXEngine/1.0 (growth-intelligence; contact@otx.ai)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.data?.children ?? []).map((p: any): RawSignal => ({
    business_id: biz.id, source_type: 'forum',
    source_url: `https://www.reddit.com${p.data.permalink}`,
    raw_text: `${p.data.title} ${p.data.selftext}`.slice(0, 2000), geo: biz.geo_city,
    detected_at_utc: new Date(p.data.created_utc * 1000).toISOString(),
    confidence_score: 0.7,
  }));
}

async function fetchGoogleTrends(biz: Business, key: string): Promise<RawSignal[]> {
  const q = encodeURIComponent(`${biz.sector} ${biz.geo_city}`);
  const res = await fetch(`https://serpapi.com/search.json?engine=google_trends&q=${q}&geo=IL&api_key=${key}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GoogleTrends HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.interest_over_time?.timeline_data ?? []).slice(-5).map((pt: any): RawSignal => ({
    business_id: biz.id, source_type: 'trend',
    source_url: `https://trends.google.com/trends/explore?q=${q}&geo=IL`,
    raw_text: `Trend data for ${biz.sector} in ${biz.geo_city}: ${pt.values.map((v: any) => `${v.query}=${v.value}`).join(', ')}`,
    geo: biz.geo_city, detected_at_utc: new Date(pt.date).toISOString(), confidence_score: 0.5,
  }));
}

async function fetchTavily(biz: Business, key: string): Promise<RawSignal[]> {
  const city = CITY_HEBREW[biz.geo_city] ?? biz.geo_city.replace(/_/g, ' ');
  const sector = SECTOR_HEBREW[biz.sector] ?? biz.sector;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query: `${sector} ${city} עדכון מגמות`, search_depth: 'basic', max_results: 6, include_answer: false, include_raw_content: false, exclude_domains: ['youtube.com', 'tiktok.com'] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.results ?? []).filter((r: any) => r.url && r.content).map((r: any): RawSignal => ({
    business_id: biz.id, source_type: 'trend', source_url: r.url,
    raw_text: `${r.title} — ${r.content}`.slice(0, 2000), geo: biz.geo_city,
    detected_at_utc: r.published_date ? new Date(r.published_date).toISOString() : new Date().toISOString(),
    confidence_score: 0.85,
  }));
}

async function fetchPlaces(biz: Business, key: string): Promise<RawSignal[]> {
  const city = CITY_HEBREW[biz.geo_city] ?? biz.geo_city.replace(/_/g, ' ');
  const q = encodeURIComponent(`${biz.name ?? biz.sector} ${city}`);
  const searchRes = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${q}&inputtype=textquery&fields=place_id,name&key=${key}`, { signal: AbortSignal.timeout(10_000) });
  if (!searchRes.ok) throw new Error(`Places search HTTP ${searchRes.status}`);
  const searchData: any = await searchRes.json();
  const placeId = searchData.candidates?.[0]?.place_id;
  if (!placeId) return [];
  const detailRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating&language=iw&key=${key}`, { signal: AbortSignal.timeout(10_000) });
  if (!detailRes.ok) throw new Error(`Places details HTTP ${detailRes.status}`);
  const detailData: any = await detailRes.json();
  return (detailData.result?.reviews ?? []).slice(0, 5).map((r: any): RawSignal => ({
    business_id: biz.id, source_type: 'social',
    source_url: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    raw_text: `ביקורת Google (${r.rating ?? '?'}/5): ${r.text ?? ''}`.slice(0, 2000),
    geo: biz.geo_city,
    detected_at_utc: r.time ? new Date(r.time * 1000).toISOString() : new Date().toISOString(),
    confidence_score: 0.92,
  }));
}

async function pingHeartbeat(status: 'OK' | 'DELAYED' | 'ERROR', lastIngestionUtc?: string, errorMessage?: string) {
  const { error } = await getSupabaseOTX().from('agent_heartbeat').insert({
    agent_name: AGENT_NAME, last_ping_utc: new Date().toISOString(),
    last_ingestion_utc: lastIngestionUtc ?? null, status, error_message: errorMessage ?? null,
  });
  if (error) logger.warn(`heartbeat insert failed: ${error.message}`);
}

export async function collectOTXSignals(): Promise<void> {
  const runStart = Date.now();
  logger.info(`${AGENT_NAME}: starting run`);

  const supabase = getSupabaseOTX();
  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, name, sector, geo_city, price_tier');
  if (bizErr) {
    await pingHeartbeat('ERROR', undefined, bizErr.message);
    return;
  }

  const serpKey   = process.env.SERPAPI_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;

  let totalInserted = 0;

  for (const biz of (businesses as Business[])) {
    const collected: RawSignal[] = [];

    if (serpKey) {
      await withRetry(`SerpAPI[${biz.id}]`, () => fetchSerpApi(biz, serpKey))
        .then(r => collected.push(...r))
        .catch((e: any) => logger.error(`SerpAPI failed for ${biz.id}: ${e.message}`));
    }
    await withRetry(`Reddit[${biz.id}]`, () => fetchReddit(biz))
      .then(r => collected.push(...r))
      .catch((e: any) => logger.error(`Reddit failed for ${biz.id}: ${e.message}`));
    if (serpKey) {
      await withRetry(`GoogleTrends[${biz.id}]`, () => fetchGoogleTrends(biz, serpKey))
        .then(r => collected.push(...r))
        .catch((e: any) => logger.error(`GoogleTrends failed for ${biz.id}: ${e.message}`));
    }
    if (tavilyKey) {
      await withRetry(`Tavily[${biz.id}]`, () => fetchTavily(biz, tavilyKey))
        .then(r => collected.push(...r))
        .catch((e: any) => logger.error(`Tavily failed for ${biz.id}: ${e.message}`));
    }
    if (placesKey) {
      await withRetry(`Places[${biz.id}]`, () => fetchPlaces(biz, placesKey))
        .then(r => collected.push(...r))
        .catch((e: any) => logger.error(`Places failed for ${biz.id}: ${e.message}`));
    }

    // In-run dedup (DB handles cross-run via text_hash generated column + UNIQUE index from migration 007)
    const seen = new Set<string>();
    const unique = collected.filter(s => {
      if (!s.business_id || !s.source_url || !s.raw_text || !s.geo || !s.detected_at_utc) return false;
      const k = `${s.business_id}|${s.source_url}|${s.raw_text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (unique.length === 0) continue;

    // ON CONFLICT(text_hash) DO NOTHING — text_hash is a DB-generated column (migration 007)
    const { error: insertErr, count } = await supabase
      .from('signals_raw')
      .upsert(unique, { onConflict: 'text_hash', ignoreDuplicates: true, count: 'exact' } as any);

    if (insertErr) {
      logger.error(`Insert failed for ${biz.id}: ${insertErr.message}`);
      await pingHeartbeat('ERROR', undefined, insertErr.message);
      continue;
    }
    totalInserted += (count as number) ?? unique.length;
  }

  const elapsed = Date.now() - runStart;
  const now = new Date().toISOString();
  const status = elapsed > MAX_LAG_MS ? 'DELAYED' : 'OK';
  await pingHeartbeat(status, now);
  logger.info(`${AGENT_NAME}: done. inserted=${totalInserted} elapsed=${Math.round(elapsed / 1000)}s status=${status}`);
}
