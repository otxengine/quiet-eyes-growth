/**
 * Shared Tavily search utility.
 * - Short-circuits all calls for the rest of the process lifetime when a 433 rate-limit is hit.
 * - Logs clearly on 433 so Render logs show the issue.
 */

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// In-memory flag: once we hit a 433, stop all further Tavily calls this process lifetime
let rateLimitHit = false;

export function isTavilyRateLimited(): boolean {
  return rateLimitHit;
}

export async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  if (rateLimitHit) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
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
