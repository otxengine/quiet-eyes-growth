/**
 * Fetches a business website, preferring an about/services page over the homepage.
 * KAN-202 AC1/AC4: tries /about, /אודות, /services in order, falls back to the
 * homepage, and never throws — a SPA/thin site or dead URL just yields null.
 */
const ABOUT_PATHS = ['/about', '/אודות', '/services'];

async function fetchText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietEyes/1.0)' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    return text || null;
  } catch {
    return null;
  }
}

export interface WebsiteSource { text: string; sourceUrl: string }

// ponytail: paths tried sequentially (simple v1); parallelize with Promise.any if latency matters.
export async function fetchWebsiteSource(baseUrl: string): Promise<WebsiteSource | null> {
  let origin: string;
  try { origin = new URL(baseUrl).origin; } catch { return null; }

  for (const path of ABOUT_PATHS) {
    const text = await fetchText(origin + path);
    if (text) return { text, sourceUrl: origin + path };
  }
  const homeText = await fetchText(baseUrl);
  return homeText ? { text: homeText, sourceUrl: baseUrl } : null;
}
