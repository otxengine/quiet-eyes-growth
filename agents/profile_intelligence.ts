// OTXEngine — Agent 7: ProfileIntelligence
// Schedule: on onboarding completion + daily at 03:00
// Output: otx_business_profiles (upsert on business_id)
// Enrichment: Tavily (sector trends) · Google Places (real rating + reviews)
// Embedding: OpenAI text-embedding-3-small (1536d)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "ProfileIntelligence";

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
  id:         string;
  name:       string;
  sector:     string;
  geo_city:   string;
  price_tier: string | null;
}

interface ExistingProfile {
  id:               string;
  version:          number;
  keywords:         string[] | null;
  embedding_vector: number[] | null;
}

interface OpenAIEmbeddingResponse {
  data:   Array<{ embedding: number[] }>;
  error?: { message: string };
}

interface TavilyResult {
  title:            string;
  content:          string;
  url:              string;
  published_date?:  string;
}

interface PlacesData {
  rating:       number | null;
  review_count: number | null;
  place_id:     string | null;
  top_keywords: string[];  // extracted from reviews
}

// ─── Base keyword derivation ──────────────────────────────────────────────────

function deriveKeywords(biz: Business): string[] {
  const sectorKeywords: Record<string, string[]> = {
    restaurant: ["מסעדה", "אוכל", "תפריט", "שף", "הזמנה", "restaurant", "food", "menu", "delivery", "takeaway"],
    fitness:    ["כושר", "אימון", "חדר כושר", "ספורט", "gym", "fitness", "workout", "training", "classes"],
    beauty:     ["יופי", "ספא", "תספורת", "מניקור", "beauty", "spa", "hair", "salon", "skin", "nails"],
    local:      ["שירות", "מקומי", "עסק", "שכונה", "local", "service", "community", "area", "business"],
  };
  const geoKeywords = [biz.geo_city, biz.geo_city.replace(/_/g, " ")];
  const tierKeywords: Record<string, string[]> = {
    budget:  ["מחיר זול", "budget", "affordable", "זול"],
    mid:     ["מחיר בינוני", "mid-range", "בינוני"],
    premium: ["יוקרה", "premium", "luxury", "פרמיום"],
  };
  return [
    ...(sectorKeywords[biz.sector] ?? []),
    ...geoKeywords,
    ...(tierKeywords[biz.price_tier ?? "mid"] ?? []),
  ];
}

// ─── Tavily: fetch sector + city trend context ─────────────────────────────────

async function fetchTavilyContext(
  biz: Business,
  apiKey: string,
): Promise<string> {
  const cityName   = CITY_HEBREW[biz.geo_city] ?? biz.geo_city.replace(/_/g, " ");
  const sectorName = SECTOR_HEBREW[biz.sector] ?? biz.sector;
  const query      = `${sectorName} ${cityName} מגמות עדכניות`;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:      apiKey,
        query,
        search_depth: "basic",
        max_results:  3,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "";

    const data: { results?: TavilyResult[] } = await res.json();
    const summaries = (data.results ?? [])
      .filter((r) => r.content)
      .map((r) => r.content.slice(0, 200))
      .join(" | ");

    console.log(`[${AGENT_NAME}] Tavily context for ${biz.id}: ${summaries.length} chars`);
    return summaries;
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Tavily context failed for ${biz.id}:`, e);
    return "";
  }
}

// ─── Google Places: fetch real rating + review keywords ───────────────────────

async function fetchPlacesData(
  biz: Business,
  apiKey: string,
): Promise<PlacesData> {
  const cityName = CITY_HEBREW[biz.geo_city] ?? biz.geo_city.replace(/_/g, " ");

  // Step 1: Text search to find place_id
  const searchQuery = encodeURIComponent(`${biz.name} ${cityName}`);
  const searchUrl   = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${searchQuery}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;

  try {
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
    if (!searchRes.ok) return { rating: null, review_count: null, place_id: null, top_keywords: [] };

    const searchData: { candidates?: Array<{ place_id?: string }> } = await searchRes.json();
    const placeId = searchData.candidates?.[0]?.place_id;
    if (!placeId) return { rating: null, review_count: null, place_id: null, top_keywords: [] };

    // Step 2: Get details + reviews
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,reviews&language=iw&key=${apiKey}`;
    const detailRes = await fetch(detailUrl, { signal: AbortSignal.timeout(10_000) });
    if (!detailRes.ok) return { rating: null, review_count: null, place_id: placeId, top_keywords: [] };

    const detailData: {
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: Array<{ text?: string }>;
      };
    } = await detailRes.json();

    const result = detailData.result;
    const reviewTexts = (result?.reviews ?? []).map((r) => r.text ?? "").join(" ");

    // Extract top recurring words from reviews (simple frequency)
    const wordFreq: Record<string, number> = {};
    reviewTexts.split(/\s+/).forEach((w) => {
      const word = w.replace(/[^\u0590-\u05FFa-zA-Z]/g, "").toLowerCase();
      if (word.length > 3) wordFreq[word] = (wordFreq[word] ?? 0) + 1;
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);

    console.log(`[${AGENT_NAME}] Places data for ${biz.id}: rating=${result?.rating}, reviews=${result?.user_ratings_total}`);

    return {
      rating:       result?.rating ?? null,
      review_count: result?.user_ratings_total ?? null,
      place_id:     placeId,
      top_keywords: topKeywords,
    };
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Places fetch failed for ${biz.id}:`, e);
    return { rating: null, review_count: null, place_id: null, top_keywords: [] };
  }
}

// ─── Build enriched profile text for embedding ───────────────────────────────

function buildProfileText(
  biz:           Business,
  keywords:      string[],
  tavilyContext: string,
  placesData:    PlacesData,
): string {
  const parts: string[] = [
    `${biz.sector} ${biz.geo_city} ${biz.price_tier ?? ""}`,
    keywords.join(" "),
  ];

  if (placesData.rating) {
    parts.push(`דירוג Google: ${placesData.rating}/5 (${placesData.review_count ?? "?"} ביקורות)`);
  }

  if (placesData.top_keywords.length > 0) {
    parts.push(`מילות מפתח מביקורות: ${placesData.top_keywords.join(" ")}`);
  }

  if (tavilyContext) {
    parts.push(`הקשר שוק: ${tavilyContext.slice(0, 400)}`);
  }

  return parts.join(" | ").trim();
}

// ─── OpenAI embeddings ────────────────────────────────────────────────────────

async function embedText(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${body}`);
  }

  const data: OpenAIEmbeddingResponse = await res.json();
  if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);
  if (!data.data[0]?.embedding) throw new Error("Empty embedding response");
  return data.data[0].embedding;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const openAiKey  = Deno.env.get("OPENAI_API_KEY");
  const tavilyKey  = Deno.env.get("TAVILY_API_KEY");
  const placesKey  = Deno.env.get("GOOGLE_PLACES_API_KEY");

  if (!openAiKey) {
    const msg = "OPENAI_API_KEY not set — cannot build embeddings";
    console.error(`[${AGENT_NAME}] ${msg}`);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, msg);
    return;
  }

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  let upserted = 0;
  let skipped  = 0;

  for (const biz of (businesses as Business[])) {
    const { data: existingData } = await supabase
      .from("otx_business_profiles")
      .select("id, version, keywords, embedding_vector")
      .eq("business_id", biz.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const existing = existingData as ExistingProfile | null;

    // Fetch enrichment in parallel
    const [tavilyContext, placesData] = await Promise.all([
      tavilyKey ? fetchTavilyContext(biz, tavilyKey) : Promise.resolve(""),
      placesKey ? fetchPlacesData(biz, placesKey)   : Promise.resolve({ rating: null, review_count: null, place_id: null, top_keywords: [] }),
    ]);

    const keywords    = deriveKeywords(biz);
    const profileText = buildProfileText(biz, keywords, tavilyContext, placesData);

    // Append top review keywords to the keyword list
    const enrichedKeywords = [
      ...keywords,
      ...placesData.top_keywords.filter((k) => !keywords.includes(k)),
    ];

    // Store Google place_id as a keyword for use by competitor_snapshot
    if (placesData.place_id) {
      const placeTag = `place_id::${placesData.place_id}`;
      if (!enrichedKeywords.includes(placeTag)) enrichedKeywords.push(placeTag);
    }

    let embeddingVector: number[];
    try {
      embeddingVector = await embedText(profileText, openAiKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Embedding failed for ${biz.id} — keeping existing:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Embedding failed for ${biz.name}: ${msg}`);
      skipped++;
      continue;
    }

    const now         = new Date().toISOString();
    const nextVersion = (existing?.version ?? 0) + 1;

    const { error: upsertErr } = await supabase
      .from("otx_business_profiles")
      .upsert(
        {
          ...(existing?.id ? { id: existing.id } : {}),
          business_id:      biz.id,
          sector:           biz.sector,
          geo:              biz.geo_city,
          price_tier:       biz.price_tier,
          keywords:         enrichedKeywords,
          embedding_vector: embeddingVector,
          updated_at:       now,
          version:          nextVersion,
          // Store enriched metadata if columns exist
          ...(placesData.rating  ? { google_rating: placesData.rating }       : {}),
          ...(placesData.review_count ? { google_review_count: placesData.review_count } : {}),
        },
        { onConflict: "business_id" },
      );

    if (upsertErr) {
      // If google_rating/google_review_count columns don't exist yet, retry without them
      const { error: upsertErr2 } = await supabase
        .from("otx_business_profiles")
        .upsert(
          {
            ...(existing?.id ? { id: existing.id } : {}),
            business_id:      biz.id,
            sector:           biz.sector,
            geo:              biz.geo_city,
            price_tier:       biz.price_tier,
            keywords:         enrichedKeywords,
            embedding_vector: embeddingVector,
            updated_at:       now,
            version:          nextVersion,
          },
          { onConflict: "business_id" },
        );
      if (upsertErr2) {
        console.error(`[${AGENT_NAME}] Upsert failed for ${biz.id}:`, upsertErr2.message);
        await pingHeartbeat(AGENT_NAME, "ERROR", undefined, upsertErr2.message);
        skipped++;
        continue;
      }
    }

    upserted++;
    console.log(
      `[${AGENT_NAME}] Profile upserted: ${biz.name} v${nextVersion} | ` +
      `${embeddingVector.length}d | rating=${placesData.rating} | ` +
      `keywords=${enrichedKeywords.length} | tavily=${tavilyContext.length > 0 ? "✓" : "—"}`,
    );
  }

  const now = new Date().toISOString();
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(`[${AGENT_NAME}] Done. Upserted: ${upserted}, Skipped: ${skipped}. Ping: ${now}`);
}

if (import.meta.main) {
  await run();
}
