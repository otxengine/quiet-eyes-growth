/**
 * Shared Tavily search utility.
 * - Short-circuits all calls for the rest of the process lifetime when a 433 rate-limit is hit.
 * - In-memory cache (60 min TTL) deduplicates repeated queries across agents in the same scan.
 * - Logs clearly on 433 so Render logs show the issue.
 */

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// In-memory flag: once we hit a 433, stop all further Tavily calls this process lifetime
let rateLimitHit = false;

// 60-minute result cache — key: "depth:query:maxResults"
const _cache = new Map<string, { results: any[]; expiresAt: number }>();
const CACHE_TTL = 60 * 60 * 1000;

function _getCached(key: string): any[] | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.results;
}

function _setCache(key: string, results: any[]): void {
  _cache.set(key, { results, expiresAt: Date.now() + CACHE_TTL });
}

export function isTavilyRateLimited(): boolean {
  return rateLimitHit;
}

async function _fetch(query: string, maxResults: number, depth: 'basic' | 'advanced'): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  if (rateLimitHit) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: depth,
        max_results: maxResults,
        include_answer: false,
      }),
    });

    if (res.status === 433 || res.status === 429) {
      rateLimitHit = true;
      console.error('[Tavily] Rate limit hit (433) — all further Tavily calls disabled until restart. Upgrade at https://tavily.com/dashboard');
      return [];
    }

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[Tavily] ${res.status}: ${body.substring(0, 200)}`);
      return [];
    }

    const data: any = await res.json();
    return data.results || [];
  } catch (e: any) {
    console.warn('[Tavily] fetch error:', e.message);
    return [];
  }
}

/** Basic search (cheaper) — with 60-min cache */
export async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  const key = `basic:${query}:${maxResults}`;
  const cached = _getCached(key);
  if (cached) { console.log(`[Tavily] cache hit: ${query.slice(0, 60)}`); return cached; }
  const results = await _fetch(query, maxResults, 'basic');
  if (results.length) _setCache(key, results);
  return results;
}

/** Advanced search (deeper, used by trend/viral agents) — with 60-min cache */
export async function tavilyAdvancedSearch(query: string, maxResults = 5): Promise<any[]> {
  const key = `adv:${query}:${maxResults}`;
  const cached = _getCached(key);
  if (cached) { console.log(`[Tavily] cache hit (adv): ${query.slice(0, 60)}`); return cached; }
  const results = await _fetch(query, maxResults, 'advanced');
  if (results.length) _setCache(key, results);
  return results;
}
