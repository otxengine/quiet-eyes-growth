/**
 * Shared helper — extracts custom_keywords and custom_urls from a business profile.
 * All agents import from here so manual edits by the user are automatically
 * picked up on the next scan run (agents re-read the profile from DB each time).
 */

/** Returns all custom keywords as a trimmed, non-empty array. */
export function parseKeywords(profile: any): string[] {
  return (profile.custom_keywords || '')
    .split(',')
    .map((k: string) => k.trim())
    .filter(Boolean);
}

/** Returns all custom URLs as a trimmed, non-empty array. */
export function parseUrls(profile: any): string[] {
  return (profile.custom_urls || '')
    .split('\n')
    .map((u: string) => u.trim())
    .filter(Boolean);
}

/** Returns hostname without www. for a URL string, or null if invalid. */
function toHostname(rawUrl: string): string | null {
  try { return new URL(rawUrl).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

const SOCIAL_DOMAINS = ['instagram', 'facebook', 'tiktok', 'twitter', 'youtube', 'linkedin'];

function isSocialDomain(hostname: string): boolean {
  return SOCIAL_DOMAINS.some(s => hostname.includes(s));
}

/**
 * Builds Tavily search queries from the business's configured URLs.
 * - Social platforms  → `"<name>" <platform>` (find mentions)
 * - Directory / review sites → `site:<domain> "<name>"` (find listings)
 */
export function buildUrlQueries(profile: any, businessName: string): string[] {
  const queries: string[] = [];
  for (const rawUrl of parseUrls(profile)) {
    const hostname = toHostname(rawUrl);
    if (!hostname) continue;
    if (isSocialDomain(hostname)) {
      const platform = hostname.split('.')[0]; // 'instagram', 'facebook', etc.
      queries.push(`"${businessName}" ${platform}`);
    } else {
      queries.push(`site:${hostname} "${businessName}"`);
    }
  }
  return queries;
}

/**
 * Builds keyword-based Tavily queries.
 * Each keyword becomes `<keyword> <cityStr>` — ready to pass to tavilySearch().
 */
export function buildKeywordQueries(profile: any, cityStr: string): string[] {
  return parseKeywords(profile).map(kw => `${kw} ${cityStr}`);
}
