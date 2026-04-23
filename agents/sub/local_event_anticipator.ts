// OTXEngine — Sub-agent 14A: LocalEventAnticipator
// Schedule: every 12 hours
// Output: hyper_local_events
// Sources: SerpAPI (Google Events search) + meta_configurations.local_radius_meters

import { supabase } from "../lib/supabase.ts";
import { pingHeartbeat } from "../lib/heartbeat.ts";
import { getCityCoords, distanceMeters } from "../lib/geo.ts";

const AGENT_NAME = "LocalEventAnticipator";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  sector: string;
  geo_city: string;
}

interface MetaConfig {
  business_id: string;
  local_radius_meters: number;
}

interface RawEvent {
  title: string;
  venue?: { name?: string; lat?: number; lng?: number };
  date?: { start_date?: string; when?: string };
  link?: string;
  description?: string;
  thumbnail?: string;
}

interface SerpEventsResult {
  events_results?: RawEvent[];
  error?: string;
}

// ─── Event type inference ─────────────────────────────────────────────────────

const EVENT_TYPE_KEYWORDS: Array<{
  type: "concert" | "sports" | "roadwork" | "market" | "festival" | "other";
  keywords: string[];
}> = [
  { type: "concert",  keywords: ["קונצרט", "הופעה", "מוזיקה", "concert", "show", "performance"] },
  { type: "sports",   keywords: ["ספורט", "מרתון", "ריצה", "כדורגל", "sports", "marathon", "run", "football", "basketball"] },
  { type: "roadwork", keywords: ["סגירת כביש", "עבודות כביש", "מחסום", "roadwork", "road closure", "construction"] },
  { type: "market",   keywords: ["שוק", "יריד", "market", "fair", "bazaar"] },
  { type: "festival", keywords: ["פסטיבל", "חג", "festival", "holiday", "celebration", "carnival"] },
];

function inferEventType(
  title: string,
  description: string = "",
): "concert" | "sports" | "roadwork" | "market" | "festival" | "other" {
  const text = `${title} ${description}`.toLowerCase();
  for (const { type, keywords } of EVENT_TYPE_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) return type;
  }
  return "other";
}

// ─── Attendance estimate by event type ───────────────────────────────────────

const ATTENDANCE_ESTIMATES: Record<string, number> = {
  concert:  2000,
  sports:   5000,
  roadwork: 0,
  market:   500,
  festival: 3000,
  other:    300,
};

// ─── SerpAPI Google Events search ─────────────────────────────────────────────

async function searchLocalEvents(city: string, apiKey: string): Promise<RawEvent[]> {
  // English city names for SerpAPI (dev key returns 0 results for Hebrew queries)
  const cityEnglish: Record<string, string> = {
    tel_aviv:       "Tel Aviv",
    bnei_brak:      "Bnei Brak",
    jerusalem:      "Jerusalem",
    haifa:          "Haifa",
    beer_sheva:     "Beer Sheva",
    ramat_gan:      "Ramat Gan",
    petah_tikva:    "Petah Tikva",
    herzliya:       "Herzliya",
    raanana:        "Ra'anana",
    bat_yam:        "Bat Yam",
    netanya:        "Netanya",
    holon:          "Holon",
    ashdod:         "Ashdod",
    ashkelon:       "Ashkelon",
    rishon_lezion:  "Rishon LeZion",
    zichron_yaakov: "Zichron Yaakov",
    modiin:         "Modi'in",
    rehovot:        "Rehovot",
    kfar_saba:      "Kfar Saba",
    hod_hasharon:   "Hod HaSharon",
    eilat:          "Eilat",
  };
  const cityName = cityEnglish[city] ?? city.replace(/_/g, " ");
  const query = encodeURIComponent(`events in ${cityName} Israel this week`);
  const url = `https://serpapi.com/search.json?engine=google_events&q=${query}&hl=en&gl=il&api_key=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
  const data: SerpEventsResult = await res.json();
  if (data.error) throw new Error(`SerpAPI error: ${data.error}`);
  return data.events_results ?? [];
}

// ─── Parse event date into ISO string ────────────────────────────────────────

function parseEventDate(raw: RawEvent): string | null {
  const s = raw.date?.start_date ?? raw.date?.when ?? "";
  if (!s) return null;

  const now = new Date();
  const currentYear = now.getFullYear();

  // Attempt full ISO parse
  let d = new Date(s);

  // If parsed successfully but year is in the past (V8 quirk: "Apr 29" → 2001),
  // try to fix by injecting the current or next year.
  if (!isNaN(d.getTime())) {
    if (d.getFullYear() < currentYear) {
      // Re-parse with explicit current year
      const base = s.replace(/,?\s*\d{4}/, "").trim();
      const withThisYear = new Date(`${base}, ${currentYear}`);
      if (!isNaN(withThisYear.getTime())) {
        d = withThisYear;
        // If still in the past, try next year
        if (d.getTime() < now.getTime() - 86_400_000) {
          const withNextYear = new Date(`${base}, ${currentYear + 1}`);
          if (!isNaN(withNextYear.getTime())) d = withNextYear;
        }
      }
    }
    // Skip events that are clearly in the past (>6h ago) — don't bump them
    if (d.getTime() < now.getTime() - 6 * 3_600_000) return null;
    return d.toISOString();
  }

  // Fallback: tomorrow evening
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);
  return tomorrow.toISOString();
}

// ─── Action window: 2h before event starts ───────────────────────────────────

function computeActionWindow(
  eventDate: string,
): { start: string; end: string } {
  const dt = new Date(eventDate);
  const start = new Date(dt.getTime() - 2 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: dt.toISOString() };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (!serpKey) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, "SERPAPI_KEY not set");
    console.error(`[${AGENT_NAME}] SERPAPI_KEY not set — aborting`);
    return;
  }

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, sector, geo_city");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  // Load meta_configurations for radius info
  const { data: metaRows } = await supabase
    .from("meta_configurations")
    .select("business_id, local_radius_meters");

  const metaMap = new Map<string, number>(
    ((metaRows ?? []) as MetaConfig[]).map((r) => [r.business_id, r.local_radius_meters]),
  );

  // Group businesses by city to avoid redundant API calls
  const byCity = new Map<string, Business[]>();
  for (const biz of (businesses ?? []) as Business[]) {
    const key = biz.geo_city;
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(biz);
  }

  let totalInserted = 0;
  let errorCount = 0;

  for (const [city, bizList] of byCity) {
    let rawEvents: RawEvent[] = [];
    try {
      rawEvents = await searchLocalEvents(city, serpKey);
      console.log(`[${AGENT_NAME}] ${city}: fetched ${rawEvents.length} events from SerpAPI`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] SerpAPI failed for ${city}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `SerpAPI failed for ${city}: ${msg}`);
      errorCount++;
      continue;
    }

    if (rawEvents.length === 0) continue;

    const cityCoords = getCityCoords(city);

    for (const biz of bizList) {
      const radius = metaMap.get(biz.id) ?? 1000;
      const rows = [];

      for (const ev of rawEvents) {
        // Compute distance from business to venue
        let distM = radius; // default: within radius (assume local event)
        if (ev.venue?.lat != null && ev.venue?.lng != null) {
          distM = distanceMeters(cityCoords.lat, cityCoords.lon, ev.venue.lat, ev.venue.lng);
        }

        // Skip events outside the business's configured radius
        if (distM > radius) continue;

        const eventDate = parseEventDate(ev);
        if (!eventDate) continue;

        const eventType = inferEventType(ev.title, ev.description ?? "");
        const { start, end } = computeActionWindow(eventDate);

        rows.push({
          business_id:         biz.id,
          event_name:          ev.title,
          event_type:          eventType,
          venue_name:          ev.venue?.name ?? null,
          distance_meters:     Math.round(distM),
          event_datetime:      eventDate,
          expected_attendance: ATTENDANCE_ESTIMATES[eventType],
          digital_signal_match: null,
          action_window_start: start,
          action_window_end:   end,
          source_url:          ev.link ?? "https://serpapi.com",
          detected_at_utc:     new Date().toISOString(),
          confidence_score:    ev.venue?.lat != null ? 0.85 : 0.65,
        });
      }

      if (rows.length === 0) continue;

      const { error: insertErr } = await supabase.from("hyper_local_events").insert(rows);
      if (insertErr) {
        console.error(`[${AGENT_NAME}] Insert failed for ${biz.id}:`, insertErr.message);
        errorCount++;
      } else {
        totalInserted += rows.length;
        console.log(`[${AGENT_NAME}] ${biz.id}: inserted ${rows.length} local event(s)`);
      }
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} city/business errors` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Events inserted: ${totalInserted}, Errors: ${errorCount}. Ping: ${now}`);
}

if (import.meta.main) {
  await run();
}
