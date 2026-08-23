/**
 * SearchAPI wrapper — competitor ad intelligence
 * Covers: Meta Ads Library, TikTok Ads Library, Google Ads
 * Docs: https://www.searchapi.io
 *
 * Meta ads prefer the Apify actor (searchMetaAdsViaApify) when configured —
 * SearchAPI's meta_ad_library engine is the fallback, same priority already
 * used elsewhere in this file for Instagram/TikTok profile scraping.
 */
import { runApifyActor, hasApifyKey } from './apify';

const SEARCHAPI_KEY = () => process.env.SEARCHAPI_API_KEY || '';
const BASE = 'https://www.searchapi.io/api/v1/search';
const TIMEOUT_MS = 15_000;

export function hasSearchApiKey(): boolean {
  return !!SEARCHAPI_KEY();
}

async function _fetch(params: Record<string, string>): Promise<any> {
  const key = SEARCHAPI_KEY();
  if (!key) return null;
  try {
    const qs = new URLSearchParams({ ...params, api_key: key }).toString();
    const res = await fetch(`${BASE}?${qs}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data?.error) {
      console.warn(`[SearchAPI] ${params.engine}: ${data.error}`);
      return null;
    }
    return data;
  } catch (e: any) {
    console.warn(`[SearchAPI] ${params.engine} failed:`, e.message);
    return null;
  }
}

export interface AdResult {
  platform:       'facebook' | 'instagram' | 'tiktok' | 'google';
  title:          string;
  body:           string;
  cta:            string;
  link:           string;
  page_name:      string;
  is_active:      boolean;
  start_date:     string | null;
  end_date:       string | null;
  audience_est:   string | null;
  external_ad_id: string | null;
  media_url:      string | null;
  video_url:      string | null;
}

// ── Meta Ads Library ──────────────────────────────────────────────────────────
export async function searchMetaAds(query: string, country = 'IL'): Promise<AdResult[]> {
  const data = await _fetch({ engine: 'meta_ad_library', q: query, country });
  if (!data?.ads) return [];

  return (data.ads as any[]).slice(0, 10).map(ad => {
    const snap = ad.snapshot || {};
    // Extract body text from cards or direct body
    const bodyText: string =
      (snap.cards?.[0]?.body as string) ||
      (typeof snap.body === 'object' ? snap.body?.text : snap.body) ||
      snap.link_description || '';
    const platforms: string[] = ad.publisher_platform || [];
    return {
      platform:       platforms.includes('INSTAGRAM') ? 'instagram' : 'facebook',
      title:          snap.title || snap.cards?.[0]?.title || '',
      body:           bodyText,
      cta:            snap.cta_text || snap.cta_type || '',
      link:           snap.link_url || snap.page_profile_uri || '',
      page_name:      snap.page_name || ad.page_name || '',
      is_active:      ad.is_active === true,
      start_date:     ad.start_date || null,
      end_date:       ad.end_date   || null,
      audience_est:   null,
      external_ad_id: ad.ad_archive_id ? String(ad.ad_archive_id) : null,
      media_url:      snap.images?.[0]?.resized_image_url || snap.images?.[0]?.url || snap.cards?.[0]?.image_url || snap.videos?.[0]?.thumbnail || null,
      video_url:      snap.videos?.[0]?.video_hd_url || snap.videos?.[0]?.video_sd_url || null,
    } as AdResult;
  }).filter(a => a.is_active);
}

// ── Meta Ads Library (Apify) ──────────────────────────────────────────────────
// Primary Meta-ads source when APIFY_API_KEY is set — richer than SearchAPI's
// meta_ad_library engine and takes the competitor's full page URL directly,
// no handle-regex needed.
export async function searchMetaAdsViaApify(pageUrl: string): Promise<AdResult[]> {
  const items = await runApifyActor(
    'apify~facebook-ads-scraper',
    { startUrls: [{ url: pageUrl }], activeStatus: 'active', resultsLimit: 10 },
    90_000, 10,
    (msg) => console.warn(`[searchMetaAdsViaApify] ${msg}`),
  );
  if (!items?.length) return [];

  const toIso = (v: any): string | null => {
    if (!v) return null;
    const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  // When a page has no active ads, the actor returns a placeholder instead of an ad —
  // confirmed against live runs to take multiple shapes ({ error: "no_items", ... }
  // for some pages, { results: [], totalCount: 0, ... } for others). Rather than
  // blacklist every "no ads" shape Apify might return, positively require the one
  // field every real ad has: adArchiveID.
  return items.filter((ad: any) => ad.adArchiveID ?? ad.ad_archive_id).slice(0, 10).map((ad: any) => {
    const snap = ad.snapshot || {};
    const bodyText: string =
      (snap.cards?.[0]?.body as string) ||
      (typeof snap.body === 'object' ? snap.body?.text : snap.body) ||
      snap.link_description || '';
    const platforms: string[] = (ad.publisherPlatform || ad.publisher_platform || [])
      .map((p: string) => String(p).toUpperCase());
    return {
      platform:       platforms.includes('INSTAGRAM') ? 'instagram' : 'facebook',
      title:          snap.title || snap.cards?.[0]?.title || '',
      body:           bodyText,
      cta:            snap.ctaText || snap.cta_text || snap.ctaType || snap.cta_type || '',
      link:           snap.linkUrl || snap.link_url || snap.page_profile_uri || '',
      page_name:      ad.pageName || ad.page_name || snap.page_name || '',
      is_active:      ad.isActive !== false && ad.is_active !== false,
      start_date:     toIso(ad.startDate ?? ad.start_date),
      end_date:       toIso(ad.endDate ?? ad.end_date),
      audience_est:   null,
      external_ad_id: (ad.adArchiveID ?? ad.ad_archive_id) ? String(ad.adArchiveID ?? ad.ad_archive_id) : null,
      media_url:      snap.images?.[0]?.resized_image_url || snap.images?.[0]?.url ||
                       snap.cards?.[0]?.originalImageUrl || snap.cards?.[0]?.resizedImageUrl ||
                       snap.videos?.[0]?.thumbnail || null,
      video_url:      snap.videos?.[0]?.video_hd_url || snap.videos?.[0]?.videoHdUrl ||
                       snap.cards?.[0]?.videoHdUrl || null,
    } as AdResult;
  });
}

// ── TikTok Ads Library ────────────────────────────────────────────────────────
// TikTok only supports EU countries in its library — use country=all
export async function searchTikTokAds(query: string): Promise<AdResult[]> {
  const data = await _fetch({ engine: 'tiktok_ads_library', q: query, country: 'all' });
  if (!data?.ads) return [];

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // last 30 days

  return (data.ads as any[])
    .filter(ad => {
      const last = ad.last_shown_datetime ? new Date(ad.last_shown_datetime).getTime() : 0;
      return last >= cutoff;
    })
    .slice(0, 5)
    .map(ad => ({
      platform:       'tiktok' as const,
      title:          '',
      body:           '',
      cta:            '',
      link:           ad.video_link || '',
      page_name:      ad.advertiser || '',
      is_active:      true,
      start_date:     ad.first_shown_datetime || null,
      end_date:       ad.last_shown_datetime  || null,
      audience_est:   ad.estimated_audience   || null,
      external_ad_id: ad.id ? String(ad.id) : null,
      media_url:      ad.thumbnail || null,
      video_url:      ad.video_link || null,
    }));
}

// ── Google Ads ────────────────────────────────────────────────────────────────
export async function searchGoogleAds(query: string): Promise<AdResult[]> {
  const data = await _fetch({ engine: 'google', q: query, gl: 'il' });
  if (!data?.ads) return [];

  return (data.ads as any[]).slice(0, 5).map(ad => ({
    platform:       'google' as const,
    title:          ad.title   || '',
    body:           ad.snippet || '',
    cta:            '',
    link:           ad.link    || '',
    page_name:      ad.source  || ad.domain || '',
    is_active:      true,
    start_date:     null,
    end_date:       null,
    audience_est:   null,
    external_ad_id: null,
    media_url:      null,
    video_url:      null,
  }));
}

// ── Instagram profile posts (fallback when Apify is unavailable) ─────────────
export interface InstagramPost {
  caption:        string;
  likes:          number;
  comments_count: number;
  timestamp:      string;
}

export async function searchInstagramPosts(username: string): Promise<InstagramPost[]> {
  // Try Instagram engine first
  const data = await _fetch({ engine: 'instagram', q: username });
  if (data?.posts?.length) {
    return (data.posts as any[]).slice(0, 10).map((p: any) => ({
      caption:        p.caption || p.description || '',
      likes:          p.likes_count || p.likes || 0,
      comments_count: p.comments_count || 0,
      timestamp:      p.timestamp || p.created_at || '',
    })).filter(p => p.caption);
  }
  // Fallback: Google search on instagram.com profile
  const gData = await _fetch({ engine: 'google', q: `site:instagram.com/${username}`, gl: 'il' });
  if (gData?.organic_results?.length) {
    return (gData.organic_results as any[]).slice(0, 8).map((r: any) => ({
      caption:        r.snippet || r.title || '',
      likes:          0,
      comments_count: 0,
      timestamp:      '',
    })).filter(p => p.caption);
  }
  return [];
}

// ── TikTok profile videos (fallback when Apify is unavailable) ────────────────
export interface TikTokVideo {
  title:         string;
  views:         number;
  likes:         number;
  comments:      number;
  url:           string;
}

export async function searchTikTokProfileVideos(username: string): Promise<TikTokVideo[]> {
  const query = username.startsWith('@') ? username : `@${username}`;
  const data = await _fetch({ engine: 'tiktok', q: query });
  if (data?.videos?.length) {
    return (data.videos as any[]).slice(0, 10).map((v: any) => ({
      title:    v.title || v.desc || '',
      views:    v.play_count || v.views || 0,
      likes:    v.digg_count || v.likes || 0,
      comments: v.comment_count || v.comments || 0,
      url:      v.url || v.share_url || '',
    })).filter(v => v.title);
  }
  return [];
}

// ── Google Trends Trending Now ────────────────────────────────────────────────
export interface TrendingNowResult {
  title:            string;
  traffic:          string; // e.g. "500K+"
  related_articles: string[];
}

export async function searchTrendingNow(geo = 'IL'): Promise<TrendingNowResult[]> {
  const data = await _fetch({ engine: 'google_trends_trending_now', geo });
  if (!data?.trending_searches) return [];
  return (data.trending_searches as any[]).slice(0, 15).map((t: any) => ({
    title:            t.title || t.query || '',
    traffic:          t.formattedTraffic || t.traffic || '',
    related_articles: ((t.articles || []) as any[]).slice(0, 2).map((a: any) => a.title || ''),
  })).filter(t => t.title);
}

// ── YouTube Trends ─────────────────────────────────────────────────────────────
export async function searchYouTubeTrends(query: string): Promise<string[]> {
  const data = await _fetch({ engine: 'youtube', q: query, order: 'viewCount' });
  if (!data?.videos) return [];
  return (data.videos as any[]).slice(0, 8).map((v: any) => v.title || '').filter(Boolean);
}

// ── Google News ───────────────────────────────────────────────────────────────
export async function searchGoogleNews(query: string, lang = 'he'): Promise<string[]> {
  const data = await _fetch({ engine: 'google_news', q: query, hl: lang, gl: 'il' });
  if (!data?.news_results) return [];
  return (data.news_results as any[]).slice(0, 8).map((n: any) => n.title || '').filter(Boolean);
}

// ── Combined: search all platforms ──────────────────────────────────────────
export async function searchAllAds(
  competitorName: string,
  category: string,
  city: string,
  facebookHandle?: string | null,
  tiktokHandle?: string | null,
  facebookUrl?: string | null,
): Promise<AdResult[]> {
  let metaAds: AdResult[] = [];
  if (facebookUrl && hasApifyKey()) metaAds = await searchMetaAdsViaApify(facebookUrl);
  if (metaAds.length === 0 && facebookHandle) metaAds = await searchMetaAds(facebookHandle, 'IL');

  const tiktokAds = tiktokHandle ? await searchTikTokAds(tiktokHandle) : [];
  const combined = [...metaAds, ...tiktokAds];

  // ponytail: Google only when both libraries are empty — saves credits (KAN-172)
  return combined.length > 0 ? combined : searchGoogleAds(`${competitorName} ${category} ${city}`);
}
