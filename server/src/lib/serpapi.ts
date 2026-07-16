/**
 * Shared SerpAPI client — structured Google data for all server-side agents.
 *
 * Provides three engines:
 *  - serpGoogleEvents()  — Google Events structured results (name, date, venue, ticket URL)
 *  - serpGoogleMaps()    — Google Maps local business listings (name, rating, reviews, address)
 *  - serpGoogleTrends()  — Google Trends interest-over-time for a query in Israel
 *
 * All functions return [] / null on missing key, errors, or rate limits.
 * Results are cached in-memory for 1 hour to avoid duplicate calls.
 */

const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || '';
const BASE = 'https://serpapi.com/search.json';

// ── In-memory cache (1h TTL) ────────────────────────────────────────────────
const _cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 60 * 60 * 1000;

function _getCached(key: string): any | null {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _cache.delete(key); return null; }
  return e.data;
}
function _setCache(key: string, data: any) {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

export function hasSerpApiKey(): boolean { return !!SERPAPI_KEY; }

async function _get(params: Record<string, string>): Promise<any | null> {
  if (!SERPAPI_KEY) return null;
  const qs = new URLSearchParams({ ...params, api_key: SERPAPI_KEY }).toString();
  try {
    const res = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      console.warn(`[SerpAPI] HTTP ${res.status} for engine=${params.engine}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.warn('[SerpAPI] fetch error:', e.message);
    return null;
  }
}

/**
 * Google Events engine — returns upcoming events matching query near location.
 * @param query    e.g. "הופעות קונצרטים תל אביב"
 * @param location e.g. "Tel Aviv, Israel"
 */
export async function serpGoogleEvents(query: string, location: string): Promise<any[]> {
  const cacheKey = `events:${query}:${location}`;
  const cached = _getCached(cacheKey);
  if (cached) return cached;

  const data = await _get({ engine: 'google_events', q: query, location, hl: 'iw', gl: 'il' });
  const events = data?.events_results || [];
  if (events.length) _setCache(cacheKey, events);
  return events;
}

/**
 * Google Maps local search — returns local businesses with ratings, reviews, address.
 * @param query    e.g. "מסעדה תל אביב"
 * @param location e.g. "Tel Aviv, Israel"
 */
export async function serpGoogleMaps(query: string, location: string): Promise<any[]> {
  const cacheKey = `maps:${query}:${location}`;
  const cached = _getCached(cacheKey);
  if (cached) return cached;

  const data = await _get({ engine: 'google_maps', q: query, location, hl: 'iw', gl: 'il', type: 'search' });
  const places = data?.local_results || [];
  if (places.length) _setCache(cacheKey, places);
  return places;
}

/**
 * Google Maps Reviews — paginated fetch up to maxResults reviews.
 * Accepts Google Place ID (places/ChIJ...) via place_id parameter.
 * Returns [] on missing SERPAPI_KEY or errors.
 */
export async function serpGoogleMapsReviews(placeId: string, maxResults = 300): Promise<any[]> {
  if (!placeId || !SERPAPI_KEY) return [];
  const allReviews: any[] = [];
  let nextPageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      engine:   'google_maps_reviews',
      place_id: placeId,
      hl:       'iw',
      sort_by:  'newestFirst',
    };
    if (nextPageToken) params.next_page_token = nextPageToken;

    const data = await _get(params);
    if (!data) break;

    const batch: any[] = data.reviews || [];
    allReviews.push(...batch);
    nextPageToken = data.serpapi_pagination?.next_page_token;
    if (batch.length === 0) break;
  } while (nextPageToken && allReviews.length < maxResults);

  return allReviews.slice(0, maxResults);
}

/**
 * Google Trends interest-over-time for a query in Israel.
 * Returns { timeline: [{date, value}], rising_queries: string[], top_queries: string[] }
 * or null on failure.
 * @param query  e.g. "קפה קר"
 */
export async function serpGoogleTrends(query: string): Promise<{
  timeline: { date: string; value: number }[];
  rising_queries: string[];
  top_queries: string[];
} | null> {
  const cacheKey = `trends:${query}`;
  const cached = _getCached(cacheKey);
  if (cached) return cached;

  const data = await _get({
    engine: 'google_trends',
    q: query,
    geo: 'IL',
    data_type: 'TIMESERIES',
    tz: '120',
  });

  if (!data) return null;

  const timeline = (data.interest_over_time?.timeline_data || []).map((pt: any) => ({
    date:  pt.date || '',
    value: pt.values?.[0]?.value ?? 0,
  }));

  const rising_queries = (data.related_queries?.rising || [])
    .slice(0, 10)
    .map((q: any) => q.query || '');

  const top_queries = (data.related_queries?.top || [])
    .slice(0, 10)
    .map((q: any) => q.query || '');

  const result = { timeline, rising_queries, top_queries };
  if (timeline.length || rising_queries.length) _setCache(cacheKey, result);
  return result;
}

