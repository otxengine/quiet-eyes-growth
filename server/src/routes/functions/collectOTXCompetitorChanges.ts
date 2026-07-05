// OTX CompetitorSnapshot — Node.js port of agents/competitor_snapshot.ts
// Wired into the Express scheduler's 0 */6 cron. Writes to Supabase OTX schema.

import { getSupabaseOTX } from '../../lib/supabaseOTX';
import { createLogger } from '../../infra/logger';

const logger = createLogger('CollectOTXCompetitorChanges');
const AGENT_NAME = 'CompetitorSnapshot';
const MAX_LAG_MS = 900_000; // 900s budget per ticket

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business { id: string; sector: string; geo_city: string }

interface CompetitorConfig {
  id?: string;
  name: string;
  website_url?: string;
  google_place_id?: string;
  instagram_handle?: string;
  facebook_page_id?: string;
  tiktok_handle?: string;
}

interface SocialPost { id: string; caption?: string; timestamp?: string; likes?: number; comments?: number; url?: string }

interface CompetitorChangeRow {
  business_id: string; competitor_name: string;
  change_type: 'price' | 'website' | 'social' | 'reviews';
  change_summary: string; detected_at_utc: string; source_url: string;
  confidence_score: number;
  social_platform?: 'instagram' | 'facebook' | 'tiktok' | 'google' | 'website';
  post_url?: string; sentiment?: 'positive' | 'neutral' | 'negative';
  engagement_count?: number; content_excerpt?: string;
}

interface LastChangeRow { change_type: string; change_summary: string; detected_at_utc: string }

// ─── Website hash ─────────────────────────────────────────────────────────────

async function fetchWebsiteHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OTXEngine/1.0 (growth-intelligence; contact@otx.ai)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const fingerprint = html.slice(0, 500).replace(/\s+/g, ' ').trim();
    const encoded = new TextEncoder().encode(fingerprint);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch { return null; }
}

// ─── Google Places ────────────────────────────────────────────────────────────

async function fetchGooglePlaceData(placeId: string, apiKey: string): Promise<{ review_count: number | null; rating: number | null }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total&key=${apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { review_count: null, rating: null };
    const data: any = await res.json();
    return { rating: data.result?.rating ?? null, review_count: data.result?.user_ratings_total ?? null };
  } catch { return { review_count: null, rating: null }; }
}

// ─── Instagram via Apify ──────────────────────────────────────────────────────

async function fetchInstagramPosts(handle: string, apifyToken: string): Promise<SocialPost[]> {
  const cleanHandle = handle.replace(/^@/, '');
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [cleanHandle], resultsLimit: 3, addParentData: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { logger.warn(`Instagram Apify HTTP ${res.status} for @${cleanHandle}`); return []; }
    const items = (await res.json()) as any[];
    return (items ?? []).slice(0, 3).map((item: any) => ({
      id: item.id ?? item.shortCode ?? '', caption: item.caption ?? '',
      timestamp: item.timestamp, likes: item.likesCount ?? 0,
      comments: item.commentsCount ?? 0, url: item.url ?? `https://www.instagram.com/${cleanHandle}/`,
    }));
  } catch (e: any) { logger.warn(`Instagram fetch failed for @${cleanHandle}: ${e.message}`); return []; }
}

// ─── Facebook via Apify ───────────────────────────────────────────────────────

async function fetchFacebookPosts(pageId: string, apifyToken: string): Promise<SocialPost[]> {
  const pageUrl = pageId.startsWith('http') ? pageId : `https://www.facebook.com/${pageId}`;
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?token=${apifyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrls: [{ url: pageUrl }], resultsLimit: 3 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { logger.warn(`Facebook Apify HTTP ${res.status} for ${pageId}`); return []; }
    const items = (await res.json()) as any[];
    return (items ?? []).slice(0, 3).map((item: any) => ({
      id: item.postId ?? '', caption: item.text ?? '', timestamp: item.time,
      likes: item.likes ?? 0, comments: item.comments ?? 0, url: item.url ?? pageUrl,
    }));
  } catch (e: any) { logger.warn(`Facebook Apify fetch failed for ${pageId}: ${e.message}`); return []; }
}

// ─── TikTok via Apify ─────────────────────────────────────────────────────────

async function fetchTikTokPosts(handle: string, apifyToken: string): Promise<SocialPost[]> {
  const cleanHandle = handle.replace(/^@/, '');
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/run-sync-get-dataset-items?token=${apifyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: [`https://www.tiktok.com/@${cleanHandle}`], resultsPerPage: 3, shouldDownloadVideos: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { logger.warn(`TikTok Apify HTTP ${res.status} for @${cleanHandle}`); return []; }
    const items = (await res.json()) as any[];
    return (items ?? []).slice(0, 3).map((item: any) => ({
      id: item.id ?? '', caption: item.text ?? '',
      timestamp: item.createTime ? new Date(item.createTime * 1000).toISOString() : undefined,
      likes: item.diggCount ?? 0, comments: item.commentCount ?? 0,
      url: item.webVideoUrl ?? `https://www.tiktok.com/@${cleanHandle}`,
    }));
  } catch (e: any) { logger.warn(`TikTok fetch failed for @${cleanHandle}: ${e.message}`); return []; }
}

// ─── Sentiment heuristic ──────────────────────────────────────────────────────

function inferSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  const lower = text.toLowerCase();
  if (['מבצע', 'הנחה', 'חינם', 'חדש', 'מדהים', 'great', 'love', 'amazing', 'free', 'discount', 'new'].some(w => lower.includes(w))) return 'positive';
  if (['סגור', 'בעיה', 'שגיאה', 'closed', 'error', 'problem', 'fail'].some(w => lower.includes(w))) return 'negative';
  return 'neutral';
}

// ─── Social post diff ─────────────────────────────────────────────────────────

function detectSocialChanges(
  posts: SocialPost[], platform: 'instagram' | 'facebook' | 'tiktok',
  competitor: CompetitorConfig, businessId: string, prevMap: Map<string, LastChangeRow>,
): CompetitorChangeRow[] {
  const changes: CompetitorChangeRow[] = [];
  const now = new Date().toISOString();
  const lastSocial = prevMap.get(`social_${platform}`);
  const lastTs = lastSocial ? new Date(lastSocial.change_summary.match(/ts:([^|]+)/)?.[1] ?? '1970').getTime() : 0;

  for (const post of posts) {
    const postTs = post.timestamp ? new Date(post.timestamp).getTime() : Date.now();
    if (lastTs > 0 && postTs <= lastTs) continue;
    const engagement = (post.likes ?? 0) + (post.comments ?? 0);
    const excerpt = (post.caption ?? '').slice(0, 300);
    changes.push({
      business_id: businessId, competitor_name: competitor.name, change_type: 'social',
      change_summary: `New ${platform} post · ts:${post.timestamp ?? now}|id:${post.id}`,
      detected_at_utc: now, source_url: post.url ?? '', confidence_score: 0.80,
      social_platform: platform, post_url: post.url, sentiment: inferSentiment(excerpt),
      engagement_count: engagement > 0 ? engagement : undefined, content_excerpt: excerpt || undefined,
    });
  }
  return changes;
}

// ─── Website + reviews diff ───────────────────────────────────────────────────

function detectWebChanges(
  websiteHash: string | null, reviewData: { review_count: number | null; rating: number | null },
  competitor: CompetitorConfig, businessId: string, prevMap: Map<string, LastChangeRow>,
): CompetitorChangeRow[] {
  const changes: CompetitorChangeRow[] = [];
  const now = new Date().toISOString();

  const lastWebsite = prevMap.get('website');
  const prevHash = lastWebsite?.change_summary.match(/hash:([a-f0-9]+)/)?.[1] ?? null;
  if (websiteHash && prevHash && websiteHash !== prevHash) {
    changes.push({
      business_id: businessId, competitor_name: competitor.name, change_type: 'website',
      change_summary: `Website content changed. New hash:${websiteHash}`,
      detected_at_utc: now, source_url: competitor.website_url ?? '',
      confidence_score: 0.75, social_platform: 'website',
    });
  }

  const lastReviews = prevMap.get('reviews');
  const prevCount = lastReviews ? parseInt(lastReviews.change_summary.match(/count:(\d+)/)?.[1] ?? '0') : null;
  if (reviewData.review_count !== null && prevCount !== null && reviewData.review_count !== prevCount) {
    const delta = reviewData.review_count - prevCount;
    changes.push({
      business_id: businessId, competitor_name: competitor.name, change_type: 'reviews',
      change_summary: `Review count changed by ${delta > 0 ? '+' : ''}${delta}. New count:${reviewData.review_count}`,
      detected_at_utc: now,
      source_url: competitor.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${competitor.google_place_id}`
        : competitor.website_url ?? '',
      confidence_score: 0.85, social_platform: 'google',
    });
  }
  return changes;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function collectOTXCompetitorChanges(): Promise<void> {
  const runStart = Date.now();
  logger.info(`${AGENT_NAME} starting`);

  const supabase = getSupabaseOTX();

  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, sector, geo_city');
  if (bizErr) {
    logger.error(`Failed to fetch businesses: ${bizErr.message}`);
    await supabase.from('agent_heartbeat').insert({ agent_name: AGENT_NAME, last_ping_utc: new Date().toISOString(), status: 'ERROR', error_message: bizErr.message });
    return;
  }

  const googleKey  = process.env.GOOGLE_PLACES_API_KEY;
  const apifyToken = process.env.APIFY_API_KEY;

  let totalChanges = 0;
  let errorCount   = 0;

  for (const biz of (businesses as Business[])) {
    // Load competitor configs
    const { data: configRows } = await supabase
      .from('competitor_config')
      .select('id, competitor_name, website_url, google_place_id, instagram_handle, facebook_page_id, tiktok_handle')
      .eq('business_id', biz.id)
      .eq('is_active', true);

    const competitors: CompetitorConfig[] = configRows && configRows.length > 0
      ? configRows.map((r: any) => ({
          id: r.id, name: r.competitor_name, website_url: r.website_url ?? undefined,
          google_place_id: r.google_place_id ?? undefined, instagram_handle: r.instagram_handle ?? undefined,
          facebook_page_id: r.facebook_page_id ?? undefined, tiktok_handle: r.tiktok_handle ?? undefined,
        }))
      : [];

    if (competitors.length === 0) continue;

    for (const comp of competitors) {
      // Load previous state
      const { data: prevRows } = await supabase
        .from('competitor_changes')
        .select('change_type, change_summary, detected_at_utc')
        .eq('business_id', biz.id)
        .eq('competitor_name', comp.name)
        .order('detected_at_utc', { ascending: false })
        .limit(20);

      const prevMap = new Map<string, LastChangeRow>();
      for (const row of (prevRows ?? []) as LastChangeRow[]) {
        if (!prevMap.has(row.change_type)) prevMap.set(row.change_type, row);
        if (row.change_type === 'social') {
          const platform = (row.change_summary.match(/New (instagram|facebook|tiktok)/) ?? [])[1];
          if (platform && !prevMap.has(`social_${platform}`)) prevMap.set(`social_${platform}`, row);
        }
      }

      const allChanges: CompetitorChangeRow[] = [];

      // Source 1: Website hash + Source 2: Google Places
      if (comp.website_url) {
        const websiteHash = await fetchWebsiteHash(comp.website_url);
        let reviewData = { review_count: null as number | null, rating: null as number | null };
        if (comp.google_place_id && googleKey) reviewData = await fetchGooglePlaceData(comp.google_place_id, googleKey);
        allChanges.push(...detectWebChanges(websiteHash, reviewData, comp, biz.id, prevMap));

        if (!prevMap.has('website') && websiteHash) {
          await supabase.from('competitor_changes').insert([{
            business_id: biz.id, competitor_name: comp.name, change_type: 'website',
            change_summary: `Baseline snapshot. hash:${websiteHash}`,
            detected_at_utc: new Date().toISOString(), source_url: comp.website_url,
            confidence_score: 0.75, social_platform: 'website',
          }]);
        }
      }

      // Source 3: Instagram
      if (comp.instagram_handle && apifyToken)
        allChanges.push(...detectSocialChanges(await fetchInstagramPosts(comp.instagram_handle, apifyToken), 'instagram', comp, biz.id, prevMap));

      // Source 4: Facebook
      if (comp.facebook_page_id && apifyToken)
        allChanges.push(...detectSocialChanges(await fetchFacebookPosts(comp.facebook_page_id, apifyToken), 'facebook', comp, biz.id, prevMap));

      // Source 5: TikTok
      if (comp.tiktok_handle && apifyToken)
        allChanges.push(...detectSocialChanges(await fetchTikTokPosts(comp.tiktok_handle, apifyToken), 'tiktok', comp, biz.id, prevMap));

      if (allChanges.length === 0) continue;

      const { error: insertErr } = await supabase.from('competitor_changes').insert(allChanges);
      if (insertErr) {
        logger.error(`Insert failed for ${comp.name}: ${insertErr.message}`);
        errorCount++;
      } else {
        totalChanges += allChanges.length;
        logger.info(`${comp.name}: ${allChanges.length} change(s) written`);

        // Publish to agent_data_bus for internal orchestration
        const { error: busErr } = await supabase.from('agent_data_bus').insert({
          business_id: biz.id, source_agent: AGENT_NAME,
          source_record_id: crypto.randomUUID(), source_table: 'competitor_changes',
          event_type: 'competitor_change',
          payload: {
            competitor_name: comp.name, change_count: allChanges.length,
            change_types: [...new Set(allChanges.map(c => c.change_type))],
            platforms: [...new Set(allChanges.map(c => c.social_platform).filter(Boolean))],
          },
          priority: 2, target_agents: ['ActionScoringService', 'CrossSectorBridgeAgent'],
          consumed_by: [], expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), processed: false,
        });
        if (busErr) logger.warn(`agent_data_bus publish failed for ${comp.name}: ${busErr.message}`);
      }
    }
  }

  const elapsed = Date.now() - runStart;
  const status = elapsed > MAX_LAG_MS || errorCount > 0 ? 'DELAYED' : 'OK';
  const now = new Date().toISOString();
  await supabase.from('agent_heartbeat').insert({
    agent_name: AGENT_NAME, last_ping_utc: now, last_ingestion_utc: now,
    status, error_message: errorCount > 0 ? `${errorCount} insert errors` : null,
  });
  logger.info(`Done. changes=${totalChanges} errors=${errorCount} elapsed=${Math.round(elapsed / 1000)}s status=${status}`);
}
