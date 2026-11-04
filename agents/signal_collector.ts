// OTXEngine — Agent 1: SignalCollector
// Schedule: every 30 minutes
// Output: signals_raw
// Sources: SerpAPI (search) · Reddit (forum) · Google Trends (trend) · Tavily (news) · Google Places Reviews (high-intent)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "SignalCollector";

// ─── City/Sector Hebrew maps (shared) ────────────────────────────────────────

const CITY_HEBREW: Record<string, string> = {
  tel_aviv: "תל אביב", bnei_brak: "בני ברק", jerusalem: "ירושלים",
  haifa: "חיפה", beer_sheva: "באר שבע", ramat_gan: "רמת גן",
  petah_tikva: "פתח תקווה", herzliya: "הרצליה", raanana: "רעננה",
  bat_yam: "בת ים", netanya: "נתניה", holon: "חולון",
  ashdod: "אשדוד", ashkelon: "אשקלון", rishon_lezion: "ראשון לציון",
};

const SECTOR_HEBREW: Record<string, string> = {
  restaurant: "מסעדה אוכל", fitness: "חדר כושר ספורט",
  beauty: "יופי ספא תספורת", local: "עסק מקומי שירות",
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  sector: "restaurant" | "fitness" | "beauty" | "local";
  geo_city: string;
  price_tier: "budget" | "mid" | "premium" | null;
}

interface RawSignal {
  business_id: string;
  source_type: "social" | "forum" | "trend";
  source_url: string;
  raw_text: string;
  geo: string;
  detected_at_utc: string;
  confidence_score: number;
}

interface SerpApiResult {
  title: string;
  snippet: string;
  link: string;
  date?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiResult[];
  error?: string;
}

interface RedditPost {
  data: {
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    created_utc: number;
  };
}

interface RedditResponse {
  data?: { children?: RedditPost[] };
}

interface TavilyResult {
  title: string;
  content: string;
  url: string;
  published_date?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

interface PlacesSearchResult {
  place_id?: string;
  name?: string;
}

interface PlacesReview {
  text?: string;
  rating?: number;
  time?: number;
  author_name?: string;
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function assignConfidence(sourceType: "api" | "scraped" | "inferred" | "review"): number {
  const map = { api: 0.9, review: 0.92, scraped: 0.7, inferred: 0.5 };
  return map[sourceType];
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function hourBucket(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

function dedupKey(signal: RawSignal): string {
  return `${signal.source_url}|${signal.geo}|${hourBucket(signal.detected_at_utc)}`;
}

// ─── Source 1: SerpAPI (Google Search) ───────────────────────────────────────

async function fetchFromSerpApi(business: Business, apiKey: string): Promise<RawSignal[]> {
  const query = encodeURIComponent(
    `${business.sector} ${business.geo_city} ${business.price_tier ?? ""}`.trim(),
  );
  const url = `https://serpapi.com/search.json?q=${query}&hl=iw&gl=il&num=10&api_key=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);

  const data: SerpApiResponse = await res.json();
  if (data.error) throw new Error(`SerpAPI error: ${data.error}`);

  return (data.organic_results ?? []).map((r): RawSignal => ({
    business_id:      business.id,
    source_type:      "trend",
    source_url:       r.link,
    raw_text:         `${r.title} — ${r.snippet}`,
    geo:              business.geo_city,
    detected_at_utc:  r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    confidence_score: assignConfidence("api"),
  }));
}

// ─── Source 2: Reddit ─────────────────────────────────────────────────────────

async function fetchFromReddit(business: Business): Promise<RawSignal[]> {
  const sectorMap: Record<Business["sector"], string> = {
    restaurant: "food+israelifood",
    fitness:    "fitness+israelisports",
    beauty:     "beauty+selfcare",
    local:      "israel+telaviv",
  };
  const subreddit = sectorMap[business.sector];
  const query = encodeURIComponent(`${business.geo_city} ${business.price_tier ?? ""}`);
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${query}&sort=new&limit=10&restrict_sr=1`;

  const res = await fetch(url, {
    headers: { "User-Agent": "OTXEngine/1.0 (growth-intelligence; contact@otx.ai)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);

  const data: RedditResponse = await res.json();
  const posts = data.data?.children ?? [];

  return posts.map((p): RawSignal => ({
    business_id:      business.id,
    source_type:      "forum",
    source_url:       `https://www.reddit.com${p.data.permalink}`,
    raw_text:         `${p.data.title} ${p.data.selftext}`.slice(0, 2000),
    geo:              business.geo_city,
    detected_at_utc:  new Date(p.data.created_utc * 1000).toISOString(),
    confidence_score: assignConfidence("scraped"),
  }));
}

// ─── Source 3: Google Trends via SerpAPI ──────────────────────────────────────

async function fetchFromGoogleTrends(business: Business, serpKey: string): Promise<RawSignal[]> {
  const query = encodeURIComponent(`${business.sector} ${business.geo_city}`);
  const url = `https://serpapi.com/search.json?engine=google_trends&q=${query}&geo=IL&api_key=${serpKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);

  const data: {
    interest_over_time?: {
      timeline_data?: Array<{
        values: Array<{ query: string; value: string }>;
        date: string;
      }>;
    };
  } = await res.json();

  const timeline = data.interest_over_time?.timeline_data ?? [];

  return timeline.slice(-5).map((point): RawSignal => ({
    business_id:      business.id,
    source_type:      "trend",
    source_url:       `https://trends.google.com/trends/explore?q=${query}&geo=IL`,
    raw_text:         `Trend data for ${business.sector} in ${business.geo_city}: ${point.values.map((v) => `${v.query}=${v.value}`).join(", ")}`,
    geo:              business.geo_city,
    detected_at_utc:  new Date(point.date).toISOString(),
    confidence_score: assignConfidence("inferred"),
  }));
}

// ─── Source 4: Tavily — real Hebrew news articles ─────────────────────────────

async function fetchFromTavily(business: Business, apiKey: string): Promise<RawSignal[]> {
  const cityName = CITY_HEBREW[business.geo_city] ?? business.geo_city.replace(/_/g, " ");
  const sectorName = SECTOR_HEBREW[business.sector] ?? business.sector;
  const query = `${sectorName} ${cityName} עדכון מגמות`;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:              apiKey,
      query,
      search_depth:         "basic",
      max_results:          6,
      include_answer:       false,
      include_raw_content:  false,
      include_domains:      [],
      exclude_domains:      ["youtube.com", "tiktok.com"],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

  const data: TavilyResponse = await res.json();

  return (data.results ?? [])
    .filter((r) => r.url && r.content)
    .map((r): RawSignal => ({
      business_id:      business.id,
      source_type:      "trend",
      source_url:       r.url,
      raw_text:         `${r.title} — ${r.content}`.slice(0, 2000),
      geo:              business.geo_city,
      detected_at_utc:  r.published_date
        ? new Date(r.published_date).toISOString()
        : new Date().toISOString(),
      confidence_score: 0.85, // Tavily returns high-quality sourced content
    }));
}

// ─── Source 5: Google Places Reviews — highest-intent signals ─────────────────
// Finds the business by text search, then pulls its recent reviews

async function fetchFromGooglePlacesReviews(
  business: Business,
  apiKey: string,
): Promise<RawSignal[]> {
  const cityName = CITY_HEBREW[business.geo_city] ?? business.geo_city.replace(/_/g, " ");

  // Step 1: Find Place ID by business name + city
  const searchQuery = encodeURIComponent(`${business.name ?? business.sector} ${cityName}`);
  const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${searchQuery}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;

  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
  if (!searchRes.ok) throw new Error(`Places findplace HTTP ${searchRes.status}`);

  const searchData: { candidates?: PlacesSearchResult[] } = await searchRes.json();
  const placeId = searchData.candidates?.[0]?.place_id;
  if (!placeId) return [];

  // Step 2: Fetch reviews for that place
  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating&language=iw&key=${apiKey}`;
  const detailRes = await fetch(detailUrl, { signal: AbortSignal.timeout(10_000) });
  if (!detailRes.ok) throw new Error(`Places details HTTP ${detailRes.status}`);

  const detailData: { result?: { reviews?: PlacesReview[] } } = await detailRes.json();
  const reviews = detailData.result?.reviews ?? [];

  return reviews.slice(0, 5).map((r): RawSignal => ({
    business_id:      business.id,
    source_type:      "social",
    source_url:       `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    raw_text:         `ביקורת Google (${r.rating ?? "?"}/5): ${r.text ?? ""}`.slice(0, 2000),
    geo:              business.geo_city,
    detected_at_utc:  r.time
      ? new Date(r.time * 1000).toISOString()
      : new Date().toISOString(),
    confidence_score: assignConfidence("review"),
  }));
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  const serpKey    = Deno.env.get("SERPAPI_KEY");
  const tavilyKey  = Deno.env.get("TAVILY_API_KEY");
  const placesKey  = Deno.env.get("GOOGLE_PLACES_API_KEY");

  let totalInserted = 0;
  const seen = new Set<string>();

  for (const biz of (businesses as Business[])) {
    const collected: RawSignal[] = [];

    // Source 1: SerpAPI
    if (serpKey) {
      await fetchFromSerpApi(biz, serpKey)
        .then((r) => collected.push(...r))
        .catch((e) => console.error(`[${AGENT_NAME}] SerpAPI failed for ${biz.id}:`, e.message));
    }

    // Source 2: Reddit
    await fetchFromReddit(biz)
      .then((r) => collected.push(...r))
      .catch((e) => console.error(`[${AGENT_NAME}] Reddit failed for ${biz.id}:`, e.message));

    // Source 3: Google Trends
    if (serpKey) {
      await fetchFromGoogleTrends(biz, serpKey)
        .then((r) => collected.push(...r))
        .catch((e) => console.error(`[${AGENT_NAME}] Trends failed for ${biz.id}:`, e.message));
    }

    // Source 4: Tavily news articles (NEW)
    if (tavilyKey) {
      await fetchFromTavily(biz, tavilyKey)
        .then((r) => collected.push(...r))
        .catch((e) => console.error(`[${AGENT_NAME}] Tavily failed for ${biz.id}:`, e.message));
    }

    // Source 5: Google Places reviews for own business (NEW)
    if (placesKey) {
      await fetchFromGooglePlacesReviews(biz, placesKey)
        .then((r) => collected.push(...r))
        .catch((e) => console.error(`[${AGENT_NAME}] Places reviews failed for ${biz.id}:`, e.message));
    }

    // Deduplicate + guard against incomplete rows
    const unique: RawSignal[] = [];
    for (const s of collected) {
      if (!s.business_id || !s.source_url || !s.raw_text || !s.geo || !s.detected_at_utc) {
        console.warn(`[${AGENT_NAME}] Skipping incomplete signal from ${s.source_url}`);
        continue;
      }
      const key = dedupKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }

    if (unique.length === 0) continue;

    const { error: insertErr, count } = await supabase
      .from("signals_raw")
      .insert(unique, { count: "exact" });

    if (insertErr) {
      console.error(`[${AGENT_NAME}] Insert failed for ${biz.id}:`, insertErr.message);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, insertErr.message);
      continue;
    }

    totalInserted += count ?? unique.length;
    console.log(`[${AGENT_NAME}] ${biz.id}: inserted ${count} signals (SerpAPI+Reddit+Trends+Tavily+Places)`);
  }

  const now = new Date().toISOString();
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(`[${AGENT_NAME}] Done. Total inserted: ${totalInserted}. Ping: ${now}`);
}

// deno-lint-ignore no-explicit-any
export async function runSignalCollector(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
