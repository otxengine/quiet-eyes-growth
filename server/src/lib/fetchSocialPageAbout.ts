/**
 * Shared social page/profile About fetcher — page bio/About only, never a post feed.
 * KAN-201: single source of truth for own-about generation AND competitor enrichment.
 * Apify-only (AC4b) — no homegrown Puppeteer/fetch, no OAuth. Soft-fails per platform (AC4c).
 */
import { runApifyActor, hasApifyKey } from './apify';
import { tavilySearch } from './tavily';

export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok';

export interface SocialAboutResult {
  platform: SocialPlatform;
  aboutText: string;
  pageName?: string;
  profileUrl: string;
  raw?: any;
}

export interface SocialAboutCacheEntry extends SocialAboutResult {
  scrapedAt: string; // ISO timestamp
}

export interface FetchSocialPageAboutUrls {
  facebookUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
}

export interface FetchSocialPageAboutOptions {
  /** Previously scraped entries (caller-persisted) — keyed by profileUrl. */
  cache?: SocialAboutCacheEntry[];
  forceRegenerate?: boolean;
  /** Cache freshness window in days (ticket range: 7-30). */
  ttlDays?: number;
}

const DEFAULT_TTL_DAYS = 14;

// ponytail: FB actor id is a placeholder — "Actor IDs may evolve; the lock is Apify scrape" (ticket).
const FACEBOOK_ABOUT_ACTOR = 'apify~facebook-pages-scraper';
const INSTAGRAM_ACTOR      = 'apify~instagram-scraper';
const TIKTOK_ACTOR         = 'clockworks~tiktok-profile-scraper';

function usernameFromUrl(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() || url;
}

async function scrapeFacebook(profileUrl: string): Promise<SocialAboutResult | null> {
  const [item] = await runApifyActor(FACEBOOK_ABOUT_ACTOR, { startUrls: [{ url: profileUrl }] });
  const aboutText = item?.about || item?.info?.[0];
  if (!aboutText) return null;
  return { platform: 'facebook', aboutText, pageName: item.pageName || item.title, profileUrl, raw: item };
}

async function scrapeInstagram(profileUrl: string): Promise<SocialAboutResult | null> {
  const [item] = await runApifyActor(INSTAGRAM_ACTOR, { usernames: [usernameFromUrl(profileUrl)] });
  const aboutText = [item?.biography, item?.externalUrl].filter(Boolean).join(' — ');
  if (!aboutText) return null;
  return { platform: 'instagram', aboutText, pageName: item.fullName || item.username, profileUrl, raw: item };
}

async function scrapeTikTok(profileUrl: string): Promise<SocialAboutResult | null> {
  const [item] = await runApifyActor(TIKTOK_ACTOR, { profiles: [usernameFromUrl(profileUrl)] });
  const aboutText = item?.authorMeta?.signature;
  if (!aboutText) return null;
  return { platform: 'tiktok', aboutText, pageName: item.authorMeta?.nickName, profileUrl, raw: item };
}

const SCRAPERS: Record<SocialPlatform, (url: string) => Promise<SocialAboutResult | null>> = {
  facebook: scrapeFacebook,
  instagram: scrapeInstagram,
  tiktok: scrapeTikTok,
};

function freshCacheEntry(cache: SocialAboutCacheEntry[] | undefined, profileUrl: string, ttlDays: number): SocialAboutCacheEntry | null {
  const entry = cache?.find(c => c.profileUrl === profileUrl);
  if (!entry) return null;
  const ageMs = Date.now() - new Date(entry.scrapedAt).getTime();
  return ageMs < ttlDays * 24 * 60 * 60 * 1000 ? entry : null;
}

async function resolveOne(platform: SocialPlatform, profileUrl: string, opts: FetchSocialPageAboutOptions): Promise<SocialAboutResult | null> {
  if (!opts.forceRegenerate) {
    const fresh = freshCacheEntry(opts.cache, profileUrl, opts.ttlDays ?? DEFAULT_TTL_DAYS);
    if (fresh) return fresh;
  }

  if (hasApifyKey()) {
    try {
      const scraped = await SCRAPERS[platform](profileUrl);
      if (scraped) return scraped;
    } catch (e: any) {
      console.warn(`[fetchSocialPageAbout] ${platform} Apify scrape failed: ${e.message}`);
    }
  }

  try {
    const [hit] = await tavilySearch(profileUrl, 1);
    if (hit?.content) return { platform, aboutText: hit.content, profileUrl, raw: hit };
  } catch (e: any) {
    console.warn(`[fetchSocialPageAbout] ${platform} Tavily fallback failed: ${e.message}`);
  }

  return null;
}

/**
 * Fetches page/profile About text (bio only, not a post feed) for FB/IG/TikTok via Apify,
 * with an optional Tavily fallback and a caller-supplied TTL cache. Soft-fails per platform —
 * never invents an About when nothing was found.
 */
export async function fetchSocialPageAbout(
  urls: FetchSocialPageAboutUrls,
  opts: FetchSocialPageAboutOptions = {},
): Promise<SocialAboutResult[]> {
  const targets: Array<[SocialPlatform, string | undefined]> = [
    ['facebook', urls.facebookUrl],
    ['instagram', urls.instagramUrl],
    ['tiktok', urls.tiktokUrl],
  ];

  const results = await Promise.all(
    targets.map(([platform, profileUrl]) => (profileUrl ? resolveOne(platform, profileUrl, opts) : Promise.resolve(null))),
  );

  return results.filter((r): r is SocialAboutResult => r !== null);
}
