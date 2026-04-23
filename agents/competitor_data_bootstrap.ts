// OTXEngine — CompetitorDataBootstrap
// Mission: Seed initial data for competitors that have 0 rows in competitor_changes.
//   1. Find all competitor_configs where no competitor_change exists yet for that business
//   2. Query Google Maps / SerpAPI for basic info (rating, price range, review count)
//   3. Insert a synthetic "initial snapshot" row into competitor_changes
// Run once manually after onboarding; thereafter CompetitorSnapshot handles updates.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME   = "CompetitorDataBootstrap";
const SERPAPI_KEY  = Deno.env.get("SERPAPI_KEY") ?? "";
const GOOGLE_KEY   = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompetitorConfig {
  id:                  string;
  business_id:         string;
  name:                string;
  website_url?:        string;
  google_place_id?:    string;
}

interface PlaceDetails {
  rating:       number | null;
  user_ratings: number | null;
  price_level:  number | null;
  address:      string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchGooglePlaceDetails(placeId: string): Promise<PlaceDetails> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total,price_level,formatted_address&key=${GOOGLE_KEY}`;
  try {
    const res  = await fetch(url);
    const data = await res.json() as { result?: { rating?: number; user_ratings_total?: number; price_level?: number; formatted_address?: string } };
    const r    = data.result ?? {};
    return {
      rating:       r.rating ?? null,
      user_ratings: r.user_ratings_total ?? null,
      price_level:  r.price_level ?? null,
      address:      r.formatted_address ?? null,
    };
  } catch {
    return { rating: null, user_ratings: null, price_level: null, address: null };
  }
}

async function searchSerpForCompetitor(name: string, city: string): Promise<PlaceDetails> {
  if (!SERPAPI_KEY) return { rating: null, user_ratings: null, price_level: null, address: null };
  const q   = encodeURIComponent(`${name} ${city} reviews`);
  const url = `https://serpapi.com/search.json?engine=google_maps&q=${q}&api_key=${SERPAPI_KEY}`;
  try {
    const res  = await fetch(url);
    const data = await res.json() as { local_results?: Array<{ rating?: number; reviews?: number; address?: string }> };
    const top  = data.local_results?.[0];
    if (!top) return { rating: null, user_ratings: null, price_level: null, address: null };
    return {
      rating:       top.rating ?? null,
      user_ratings: top.reviews ?? null,
      price_level:  null,
      address:      top.address ?? null,
    };
  } catch {
    return { rating: null, user_ratings: null, price_level: null, address: null };
  }
}

function buildSummary(name: string, details: PlaceDetails): string {
  const parts: string[] = [];
  if (details.rating)       parts.push(`דירוג: ${details.rating}/5`);
  if (details.user_ratings) parts.push(`${details.user_ratings} ביקורות`);
  if (details.price_level)  parts.push(`מחיר: ${'₪'.repeat(details.price_level)}`);
  if (details.address)      parts.push(`כתובת: ${details.address}`);
  return parts.length > 0
    ? `סנאפשוט ראשוני של ${name}: ${parts.join(' | ')}`
    : `סנאפשוט ראשוני של ${name} — אין נתונים נוספים`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting bootstrap scan`);

  // 1. Get all competitor configs
  const { data: configs, error: cfgErr } = await supabase
    .from("competitor_configs")
    .select("id, business_id, name, website_url, google_place_id");

  if (cfgErr) {
    console.error(`[${AGENT_NAME}] Failed to fetch configs:`, cfgErr.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, cfgErr.message);
    return;
  }

  const allConfigs = (configs ?? []) as CompetitorConfig[];

  // 2. For each config, check if competitor_changes already has rows
  let bootstrapped = 0;

  for (const config of allConfigs) {
    const { count } = await supabase
      .from("competitor_changes")
      .select("id", { count: "exact", head: true })
      .eq("business_id", config.business_id)
      .eq("competitor_name", config.name);

    if ((count ?? 0) > 0) {
      console.log(`[${AGENT_NAME}] ${config.name} already has data — skipping`);
      continue;
    }

    console.log(`[${AGENT_NAME}] Bootstrapping ${config.name}...`);

    // 3. Fetch details (Google Places preferred, fallback to SerpAPI)
    let details: PlaceDetails;
    if (config.google_place_id && GOOGLE_KEY) {
      details = await fetchGooglePlaceDetails(config.google_place_id);
    } else {
      // Guess city from business
      const { data: biz } = await supabase
        .from("businesses")
        .select("geo_city")
        .eq("id", config.business_id)
        .single();
      const city = (biz as { geo_city?: string } | null)?.geo_city ?? "";
      details = await searchSerpForCompetitor(config.name, city);
    }

    // 4. Insert initial snapshot row
    const summary = buildSummary(config.name, details);
    const { error: insErr } = await supabase
      .from("competitor_changes")
      .insert({
        business_id:      config.business_id,
        competitor_name:  config.name,
        change_type:      "reviews",
        change_summary:   summary,
        detected_at_utc:  new Date().toISOString(),
        source_url:       config.website_url ?? `https://google.com/search?q=${encodeURIComponent(config.name)}`,
        confidence_score: 0.5,
        social_platform:  "google",
      });

    if (insErr) {
      console.error(`[${AGENT_NAME}] Insert failed for ${config.name}:`, insErr.message);
    } else {
      bootstrapped++;
      console.log(`[${AGENT_NAME}] Bootstrapped ${config.name}: ${summary}`);
    }
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(`[${AGENT_NAME}] Done — bootstrapped ${bootstrapped} competitors`);
}

if (import.meta.main) {
  await run();
}
