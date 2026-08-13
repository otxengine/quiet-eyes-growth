/**
 * KAN-218: extracts Instagram/Facebook/TikTok profile links from a competitor's
 * own website HTML. DIY-only — every fetch below targets `websiteUrl` or
 * `origin + <secondary path>`, never instagram.com/facebook.com/tiktok.com/Apify.
 */
export interface SocialLinksResult {
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
}

const SECONDARY_PATHS = ['/contact', '/about', '/אודות'];

const IG_SKIP = ['p', 'reel', 'reels', 'stories', 'tv', 'explore', 'accounts', 'share', 'intent', 'embed'];
const FB_SKIP = ['sharer', 'share', 'intent', 'login', 'dialog', 'plugins', 'tr',
  'photo.php', 'photo', 'video.php', 'video', 'videos', 'posts', 'events', 'groups', 'watch', 'l.php'];

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietEyes/1.0)' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1] ?? m[2];
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function matchInstagram(href: string): string | null {
  const m = href.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const seg = m[1].toLowerCase();
  return seg && !IG_SKIP.includes(seg) ? `https://www.instagram.com/${seg}/` : null;
}

function matchFacebook(href: string): string | null {
  const m = href.match(/(?:facebook|fb)\.com\/([^/?#]+)/i);
  if (!m) return null;
  const seg = m[1].toLowerCase();
  return seg && !FB_SKIP.includes(seg) ? href.trim() : null;
}

function matchTikTok(href: string): string | null {
  const m = href.match(/tiktok\.com\/(@[\w.-]+)/i);
  return m ? `https://www.tiktok.com/${m[1]}` : null;
}

function scanHtmlForSocialLinks(html: string): SocialLinksResult {
  const result: SocialLinksResult = { instagram_url: null, facebook_url: null, tiktok_url: null };
  for (const href of extractHrefs(html)) {
    result.instagram_url ||= matchInstagram(href);
    result.facebook_url ||= matchFacebook(href);
    result.tiktok_url ||= matchTikTok(href);
  }
  return result;
}

function merge(into: SocialLinksResult, from: SocialLinksResult): void {
  into.instagram_url ||= from.instagram_url;
  into.facebook_url ||= from.facebook_url;
  into.tiktok_url ||= from.tiktok_url;
}

function isComplete(result: SocialLinksResult): boolean {
  return !!(result.instagram_url && result.facebook_url && result.tiktok_url);
}

export async function extractSocialLinksFromWebsite(websiteUrl: string): Promise<SocialLinksResult> {
  const result: SocialLinksResult = { instagram_url: null, facebook_url: null, tiktok_url: null };

  let origin: string;
  try { origin = new URL(websiteUrl).origin; } catch { return result; }

  const homeHtml = await fetchHtml(websiteUrl);
  if (homeHtml) merge(result, scanHtmlForSocialLinks(homeHtml));

  for (const path of SECONDARY_PATHS) {
    if (isComplete(result)) break;
    const html = await fetchHtml(origin + path);
    if (html) merge(result, scanHtmlForSocialLinks(html));
  }

  return result;
}
