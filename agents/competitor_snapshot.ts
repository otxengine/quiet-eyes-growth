// OTXEngine — Agent 3: CompetitorSnapshot
// Schedule: every 6 hours
// Output: competitor_changes (diff-only — never write "no change" rows)
// Sources: website hash, Google Maps, Instagram (Apify), Facebook Graph, TikTok (Apify)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "CompetitorSnapshot";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  sector: string;
  geo_city: string;
}

interface CompetitorConfig {
  id?: string;
  name: string;
  website_url?: string;
  google_place_id?: string;
  instagram_handle?: string;
  facebook_page_id?: string;
  tiktok_handle?: string;
}

interface SocialPost {
  id: string;
  caption?: string;
  timestamp?: string;
  likes?: number;
  comments?: number;
  url?: string;
}

interface CompetitorChangeRow {
  business_id:      string;
  competitor_name:  string;
  change_type:      "price" | "website" | "social" | "reviews";
  change_summary:   string;
  detected_at_utc:  string;
  source_url:       string;
  confidence_score: number;
  social_platform?: "instagram" | "facebook" | "tiktok" | "google" | "website";
  post_url?:        string;
  sentiment?:       "positive" | "neutral" | "negative";
  engagement_count?: number;
  content_excerpt?: string;
}

interface LastChangeRow {
  change_type:     string;
  change_summary:  string;
  detected_at_utc: string;
}

// ─── Website hash ─────────────────────────────────────────────────────────────

async function fetchWebsiteHash(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "OTXEngine/1.0 (growth-intelligence; contact@otx.ai)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const fingerprint = html.slice(0, 500).replace(/\s+/g, " ").trim();
    const encoded = new TextEncoder().encode(fingerprint);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return null;
  }
}

// ─── Google Places ────────────────────────────────────────────────────────────

async function fetchGooglePlaceData(
  placeId: string,
  apiKey: string,
): Promise<{ review_count: number | null; rating: number | null }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total&key=${apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { review_count: null, rating: null };
    const data: { result?: { rating?: number; user_ratings_total?: number } } = await res.json();
    return {
      rating:       data.result?.rating ?? null,
      review_count: data.result?.user_ratings_total ?? null,
    };
  } catch {
    return { review_count: null, rating: null };
  }
}

// ─── Instagram via Apify ──────────────────────────────────────────────────────

async function fetchInstagramPosts(
  handle: string,
  apifyToken: string,
): Promise<SocialPost[]> {
  const cleanHandle = handle.replace(/^@/, "");
  const runUrl = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
  const payload = {
    usernames: [cleanHandle],
    resultsLimit: 3,
    addParentData: false,
  };

  try {
    const res = await fetch(`${runUrl}?token=${apifyToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[${AGENT_NAME}] Instagram Apify HTTP ${res.status} for @${cleanHandle}`);
      return [];
    }
    const items: Array<{
      id?: string;
      shortCode?: string;
      caption?: string;
      timestamp?: string;
      likesCount?: number;
      commentsCount?: number;
      url?: string;
    }> = await res.json();
    return (items ?? []).slice(0, 3).map((item) => ({
      id:        item.id ?? item.shortCode ?? "",
      caption:   item.caption ?? "",
      timestamp: item.timestamp,
      likes:     item.likesCount ?? 0,
      comments:  item.commentsCount ?? 0,
      url:       item.url ?? `https://www.instagram.com/${cleanHandle}/`,
    }));
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Instagram fetch failed for @${cleanHandle}:`, e);
    return [];
  }
}

// ─── Facebook via Apify (no App Review required) ─────────────────────────────
// Uses apify/facebook-posts-scraper actor — works with public pages via page slug/URL

async function fetchFacebookPosts(
  pageId: string,
  apifyToken: string,
): Promise<SocialPost[]> {
  // pageId can be a numeric ID or a page slug (e.g. "goldsgymisrael")
  const pageUrl = pageId.startsWith("http")
    ? pageId
    : `https://www.facebook.com/${pageId}`;

  const runUrl = "https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items";
  const payload = {
    startUrls: [{ url: pageUrl }],
    resultsLimit: 3,
  };

  try {
    const res = await fetch(`${runUrl}?token=${apifyToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[${AGENT_NAME}] Facebook Apify HTTP ${res.status} for ${pageId}`);
      return [];
    }
    const items: Array<{
      postId?: string;
      text?: string;
      time?: string;
      url?: string;
      likes?: number;
      comments?: number;
    }> = await res.json();
    return (items ?? []).slice(0, 3).map((item) => ({
      id:        item.postId ?? "",
      caption:   item.text ?? "",
      timestamp: item.time,
      likes:     item.likes ?? 0,
      comments:  item.comments ?? 0,
      url:       item.url ?? pageUrl,
    }));
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Facebook Apify fetch failed for ${pageId}:`, e);
    return [];
  }
}

// ─── TikTok via Apify ─────────────────────────────────────────────────────────

async function fetchTikTokPosts(
  handle: string,
  apifyToken: string,
): Promise<SocialPost[]> {
  const cleanHandle = handle.replace(/^@/, "");
  const runUrl = "https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/run-sync-get-dataset-items";
  const payload = {
    profiles: [`https://www.tiktok.com/@${cleanHandle}`],
    resultsPerPage: 3,
    shouldDownloadVideos: false,
  };

  try {
    const res = await fetch(`${runUrl}?token=${apifyToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[${AGENT_NAME}] TikTok Apify HTTP ${res.status} for @${cleanHandle}`);
      return [];
    }
    const items: Array<{
      id?: string;
      text?: string;
      createTime?: number;
      webVideoUrl?: string;
      diggCount?: number;
      commentCount?: number;
    }> = await res.json();
    return (items ?? []).slice(0, 3).map((item) => ({
      id:        item.id ?? "",
      caption:   item.text ?? "",
      timestamp: item.createTime ? new Date(item.createTime * 1000).toISOString() : undefined,
      likes:     item.diggCount ?? 0,
      comments:  item.commentCount ?? 0,
      url:       item.webVideoUrl ?? `https://www.tiktok.com/@${cleanHandle}`,
    }));
  } catch (e) {
    console.warn(`[${AGENT_NAME}] TikTok fetch failed for @${cleanHandle}:`, e);
    return [];
  }
}

// ─── Sentiment heuristic ──────────────────────────────────────────────────────

function inferSentiment(text: string): "positive" | "neutral" | "negative" {
  const lower = text.toLowerCase();
  const positive = ["מבצע", "הנחה", "חינם", "חדש", "מדהים", "great", "love", "amazing", "free", "discount", "new"];
  const negative = ["סגור", "בעיה", "שגיאה", "closed", "error", "problem", "fail"];
  if (positive.some((w) => lower.includes(w))) return "positive";
  if (negative.some((w) => lower.includes(w))) return "negative";
  return "neutral";
}

// ─── Social post diff — detect new posts since last seen ─────────────────────

function detectSocialChanges(
  posts:       SocialPost[],
  platform:    "instagram" | "facebook" | "tiktok",
  competitor:  CompetitorConfig,
  businessId:  string,
  prevMap:     Map<string, LastChangeRow>,
): CompetitorChangeRow[] {
  const changes: CompetitorChangeRow[] = [];
  const now = new Date().toISOString();

  // Check if the most recent post is newer than our last recorded social change
  const lastSocial = prevMap.get(`social_${platform}`);
  const lastTs = lastSocial
    ? new Date(lastSocial.change_summary.match(/ts:([^|]+)/)?.[1] ?? "1970").getTime()
    : 0;

  for (const post of posts) {
    const postTs = post.timestamp ? new Date(post.timestamp).getTime() : Date.now();
    if (lastTs > 0 && postTs <= lastTs) continue; // older than last seen

    const engagement = (post.likes ?? 0) + (post.comments ?? 0);
    const excerpt = (post.caption ?? "").slice(0, 300);
    const sentiment = inferSentiment(excerpt);

    changes.push({
      business_id:      businessId,
      competitor_name:  competitor.name,
      change_type:      "social",
      change_summary:   `New ${platform} post · ts:${post.timestamp ?? now}|id:${post.id}`,
      detected_at_utc:  now,
      source_url:       post.url ?? "",
      confidence_score: 0.80,
      social_platform:  platform,
      post_url:         post.url,
      sentiment,
      engagement_count: engagement > 0 ? engagement : undefined,
      content_excerpt:  excerpt || undefined,
    });
  }

  return changes;
}

// ─── Website + reviews diff ───────────────────────────────────────────────────

function detectWebChanges(
  websiteHash:  string | null,
  reviewData:   { review_count: number | null; rating: number | null },
  competitor:   CompetitorConfig,
  businessId:   string,
  prevMap:      Map<string, LastChangeRow>,
): CompetitorChangeRow[] {
  const changes: CompetitorChangeRow[] = [];
  const now = new Date().toISOString();

  // Website change
  const lastWebsite = prevMap.get("website");
  const prevHash = lastWebsite?.change_summary.match(/hash:([a-f0-9]+)/)?.[1] ?? null;
  if (websiteHash && prevHash && websiteHash !== prevHash) {
    changes.push({
      business_id:      businessId,
      competitor_name:  competitor.name,
      change_type:      "website",
      change_summary:   `Website content changed. New hash:${websiteHash}`,
      detected_at_utc:  now,
      source_url:       competitor.website_url ?? "",
      confidence_score: 0.75,
      social_platform:  "website",
    });
  }

  // Reviews change
  const lastReviews = prevMap.get("reviews");
  const prevCount = lastReviews
    ? parseInt(lastReviews.change_summary.match(/count:(\d+)/)?.[1] ?? "0")
    : null;
  if (reviewData.review_count !== null && prevCount !== null && reviewData.review_count !== prevCount) {
    const delta = reviewData.review_count - prevCount;
    changes.push({
      business_id:      businessId,
      competitor_name:  competitor.name,
      change_type:      "reviews",
      change_summary:   `Review count changed by ${delta > 0 ? "+" : ""}${delta}. New count:${reviewData.review_count}`,
      detected_at_utc:  now,
      source_url:       competitor.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${competitor.google_place_id}`
        : competitor.website_url ?? "",
      confidence_score: 0.85,
      social_platform:  "google",
    });
  }

  return changes;
}

// ─── Auto-discover competitors via SerpAPI ────────────────────────────────────

async function autoDiscoverCompetitors(
  businessId: string,
  sector:     string,
  geoCity:    string,
  serpKey:    string,
): Promise<void> {
  const cityHebrew: Record<string, string> = {
    tel_aviv:      "תל אביב",
    bnei_brak:     "בני ברק",
    jerusalem:     "ירושלים",
    haifa:         "חיפה",
    beer_sheva:    "באר שבע",
    ramat_gan:     "רמת גן",
    petah_tikva:   "פתח תקווה",
    herzliya:      "הרצליה",
    raanana:       "רעננה",
    netanya:       "נתניה",
  };
  const sectorHebrew: Record<string, string> = {
    fitness:    "חדר כושר",
    restaurant: "מסעדה",
    beauty:     "מספרה סלון יופי",
    local:      "עסק מקומי",
  };

  const cityName = cityHebrew[geoCity] ?? geoCity.replace(/_/g, " ");
  const sectorName = sectorHebrew[sector] ?? sector;
  const query = encodeURIComponent(`${sectorName} ${cityName}`);
  const url = `https://serpapi.com/search.json?engine=google_maps&q=${query}&hl=iw&gl=il&api_key=${serpKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn(`[${AGENT_NAME}] SerpAPI auto-discover HTTP ${res.status}`);
      return;
    }
    const data: {
      local_results?: Array<{
        title?: string;
        place_id?: string;
        website?: string;
        address?: string;
      }>;
    } = await res.json();

    const results = (data.local_results ?? []).slice(0, 5);
    if (results.length === 0) return;

    const rows = results
      .filter((r) => r.title)
      .map((r) => ({
        business_id:     businessId,
        competitor_name: r.title!,
        website_url:     r.website ?? null,
        google_place_id: r.place_id ?? null,
        is_active:       true,
        discovered_by:   "serp_auto",
      }));

    // Upsert — do not overwrite manual entries
    await supabase
      .from("competitor_config")
      .upsert(rows, { onConflict: "business_id,competitor_name", ignoreDuplicates: true });

    console.log(`[${AGENT_NAME}] Auto-discovered ${rows.length} competitors for ${sector}:${geoCity}`);
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Auto-discover failed:`, e);
  }
}

// ─── Load competitor configs ──────────────────────────────────────────────────

async function loadCompetitorConfigs(
  businessId: string,
  sector:     string,
  geoCity:    string,
  serpKey?:   string,
): Promise<CompetitorConfig[]> {
  // 1) Try competitor_config table first (v4 schema)
  const { data: configRows } = await supabase
    .from("competitor_config")
    .select("id, competitor_name, website_url, google_place_id, instagram_handle, facebook_page_id, tiktok_handle")
    .eq("business_id", businessId)
    .eq("is_active", true);

  if (configRows && configRows.length > 0) {
    return configRows.map((r) => ({
      id:               r.id,
      name:             r.competitor_name,
      website_url:      r.website_url ?? undefined,
      google_place_id:  r.google_place_id ?? undefined,
      instagram_handle: r.instagram_handle ?? undefined,
      facebook_page_id: r.facebook_page_id ?? undefined,
      tiktok_handle:    r.tiktok_handle ?? undefined,
    }));
  }

  // 2) Fall back to legacy keywords format in otx_business_profiles
  const { data: profileData } = await supabase
    .from("otx_business_profiles")
    .select("keywords")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const legacyConfigs: CompetitorConfig[] = (profileData?.keywords ?? [])
    .filter((k: string) => k.startsWith("competitor::"))
    .map((k: string): CompetitorConfig | null => {
      const parts = k.split("::");
      if (parts.length < 3) return null;
      return { name: parts[1], website_url: parts[2], google_place_id: parts[3] };
    })
    .filter((c: CompetitorConfig | null): c is CompetitorConfig => c !== null);

  if (legacyConfigs.length > 0) return legacyConfigs;

  // 3) Auto-discover via SerpAPI if key is available
  if (serpKey) {
    await autoDiscoverCompetitors(businessId, sector, geoCity, serpKey);
    // Re-load after discovery
    const { data: fresh } = await supabase
      .from("competitor_config")
      .select("id, competitor_name, website_url, google_place_id, instagram_handle, facebook_page_id, tiktok_handle")
      .eq("business_id", businessId)
      .eq("is_active", true);

    if (fresh && fresh.length > 0) {
      return fresh.map((r) => ({
        id:              r.id,
        name:            r.competitor_name,
        website_url:     r.website_url ?? undefined,
        google_place_id: r.google_place_id ?? undefined,
      }));
    }
  }

  console.log(`[${AGENT_NAME}] No competitors found for business ${businessId} (${sector}:${geoCity})`);
  return [];
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, sector, geo_city");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  const googleKey  = Deno.env.get("GOOGLE_PLACES_API_KEY");
  const apifyToken = Deno.env.get("APIFY_API_KEY");
  const serpKey    = Deno.env.get("SERPAPI_KEY");

  let totalChanges = 0;
  let errorCount   = 0;

  for (const biz of (businesses as Business[])) {
    const competitors = await loadCompetitorConfigs(biz.id, biz.sector, biz.geo_city, serpKey);
    if (competitors.length === 0) continue;

    for (const comp of competitors) {
      // ── Load previous state ──
      const { data: prevRows } = await supabase
        .from("competitor_changes")
        .select("change_type, change_summary, detected_at_utc")
        .eq("business_id", biz.id)
        .eq("competitor_name", comp.name)
        .order("detected_at_utc", { ascending: false })
        .limit(20);

      const prevMap = new Map<string, LastChangeRow>();
      for (const row of (prevRows ?? []) as LastChangeRow[]) {
        if (!prevMap.has(row.change_type)) prevMap.set(row.change_type, row);
        // Also track per-platform social state
        if (row.change_type === "social") {
          const platform = (row.change_summary.match(/New (instagram|facebook|tiktok)/) ?? [])[1];
          if (platform && !prevMap.has(`social_${platform}`)) {
            prevMap.set(`social_${platform}`, row);
          }
        }
      }

      const allChanges: CompetitorChangeRow[] = [];

      // ── Source 1: Website hash ──
      if (comp.website_url) {
        const websiteHash = await fetchWebsiteHash(comp.website_url);

        // ── Source 2: Google Places ──
        let reviewData = { review_count: null as number | null, rating: null as number | null };
        if (comp.google_place_id && googleKey) {
          reviewData = await fetchGooglePlaceData(comp.google_place_id, googleKey);
        }

        const webChanges = detectWebChanges(websiteHash, reviewData, comp, biz.id, prevMap);
        allChanges.push(...webChanges);

        // Record baseline hash on first run
        if (!prevMap.has("website") && websiteHash) {
          await supabase.from("competitor_changes").insert([{
            business_id:     biz.id,
            competitor_name: comp.name,
            change_type:     "website",
            change_summary:  `Baseline snapshot. hash:${websiteHash}`,
            detected_at_utc: new Date().toISOString(),
            source_url:      comp.website_url,
            confidence_score: 0.75,
            social_platform: "website",
          }]);
        }
      }

      // ── Source 3: Instagram ──
      if (comp.instagram_handle && apifyToken) {
        const posts = await fetchInstagramPosts(comp.instagram_handle, apifyToken);
        const igChanges = detectSocialChanges(posts, "instagram", comp, biz.id, prevMap);
        allChanges.push(...igChanges);
      }

      // ── Source 4: Facebook ──
      if (comp.facebook_page_id && apifyToken) {
        const posts = await fetchFacebookPosts(comp.facebook_page_id, apifyToken);
        const fbChanges = detectSocialChanges(posts, "facebook", comp, biz.id, prevMap);
        allChanges.push(...fbChanges);
      }

      // ── Source 5: TikTok ──
      if (comp.tiktok_handle && apifyToken) {
        const posts = await fetchTikTokPosts(comp.tiktok_handle, apifyToken);
        const ttChanges = detectSocialChanges(posts, "tiktok", comp, biz.id, prevMap);
        allChanges.push(...ttChanges);
      }

      if (allChanges.length === 0) continue;

      // ── Write all changes ──
      const { error: insertErr } = await supabase
        .from("competitor_changes")
        .insert(allChanges);

      if (insertErr) {
        console.error(`[${AGENT_NAME}] Insert failed for ${comp.name}:`, insertErr.message);
        errorCount++;
      } else {
        totalChanges += allChanges.length;
        console.log(`[${AGENT_NAME}] ${comp.name}: ${allChanges.length} change(s) written`);

        // Publish bus event
        await publishToBus(supabase, {
          business_id:    biz.id,
          sourceAgent:    AGENT_NAME,
          sourceRecordId: crypto.randomUUID(),
          sourceTable:    "competitor_changes",
          event_type:     "competitor_change",
          payload: {
            competitor_name: comp.name,
            change_count:    allChanges.length,
            change_types:    [...new Set(allChanges.map((c) => c.change_type))],
            platforms:       [...new Set(allChanges.map((c) => c.social_platform).filter(Boolean))],
          },
        }).catch(() => {/* non-critical */});
      }
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} insert errors` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Total changes written: ${totalChanges}, Errors: ${errorCount}. Ping: ${now}`);
}

// deno-lint-ignore no-explicit-any
export async function runCompetitorSnapshot(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
