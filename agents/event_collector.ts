// OTXEngine — Agent 2: EventCollector
// Schedule: every 60 minutes
// Output: events_raw
// Fetches: Israeli holidays, Eventbrite, sports authority, seasonal calendar

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";

const AGENT_NAME = "EventCollector";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface EventRaw {
  event_name: string;
  event_date: string;         // YYYY-MM-DD
  geo: string | null;
  source_url: string;
  detected_at_utc: string;
  confidence_score: number;
}

interface EventbriteEvent {
  name: { text: string };
  start: { local: string };
  url: string;
  venue?: { address?: { city?: string; country?: string } };
  category_id?: string;
}

interface EventbriteResponse {
  events?: EventbriteEvent[];
  error_description?: string;
}

interface HebrewCalendarEntry {
  title: string;
  date: string;
  category: string;
  link?: string;
}

interface HebrewCalendarResponse {
  items?: HebrewCalendarEntry[];
}

// Sectors the platform monitors — used for overlap filtering
const CONFIGURED_SECTORS = new Set(["restaurant", "fitness", "beauty", "local"]);

// ─── Sector overlap check ─────────────────────────────────────────────────────

function hasSectorOverlap(eventName: string, eventCategory: string): boolean {
  const text = `${eventName} ${eventCategory}`.toLowerCase();
  const sectorKeywords: Record<string, string[]> = {
    restaurant: ["אוכל", "מסעדה", "food", "restaurant", "culinary", "chef", "cuisine", "eatery"],
    fitness:    ["ספורט", "כושר", "sport", "fitness", "marathon", "gym", "run", "yoga", "triathlon"],
    beauty:     ["יופי", "beauty", "wellness", "spa", "hair", "nail", "fashion", "makeup"],
    local:      ["מקומי", "community", "local", "event", "אירוע", "fair", "market", "festival"],
  };

  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    if (!CONFIGURED_SECTORS.has(sector)) continue;
    if (keywords.some((kw) => text.includes(kw))) return true;
  }
  return false;
}

// ─── Source: HebCal (Israeli Jewish holidays + events) ───────────────────────

async function fetchIsraeliHolidays(): Promise<EventRaw[]> {
  const today = new Date();
  const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const start = today.toISOString().split("T")[0];
  const end = endDate.toISOString().split("T")[0];

  const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&nx=on&mf=on&ss=on&i=on&start=${start}&end=${end}&geo=none&lg=s`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HebCal HTTP ${res.status}`);

  const data: HebrewCalendarResponse = await res.json();
  const items = data.items ?? [];

  return items
    .filter((item) => item.category !== "parashat")
    .map((item): EventRaw => ({
      event_name: item.title,
      event_date: item.date.split("T")[0],
      geo: "IL",
      source_url: item.link ?? `https://www.hebcal.com/holidays/${encodeURIComponent(item.title)}`,
      detected_at_utc: new Date().toISOString(),
      confidence_score: 0.95,
    }));
}

// ─── Source: Eventbrite — public events in Israel ────────────────────────────

async function fetchEventbrite(): Promise<EventRaw[]> {
  const token = Deno.env.get("EVENTBRITE_API_KEY");
  if (!token) {
    console.warn(`[${AGENT_NAME}] EVENTBRITE_API_KEY not set — skipping Eventbrite`);
    return [];
  }

  const today  = new Date().toISOString();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const url    = `https://www.eventbriteapi.com/v3/events/search/?location.country=IL&start_date.range_start=${today}&start_date.range_end=${future}&expand=venue&token=${token}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Eventbrite HTTP ${res.status}`);

  const data: EventbriteResponse = await res.json();
  if (data.error_description) throw new Error(`Eventbrite: ${data.error_description}`);

  return (data.events ?? [])
    .filter((e) => hasSectorOverlap(e.name.text, e.category_id ?? ""))
    .map((e): EventRaw => ({
      event_name:      e.name.text,
      event_date:      e.start.local.split("T")[0],
      geo:             e.venue?.address?.city ?? "IL",
      source_url:      e.url,
      detected_at_utc: new Date().toISOString(),
      confidence_score: 0.90,
    }));
}

// ─── Source: SerpAPI Google Events ───────────────────────────────────────────

async function fetchSerpApiEvents(): Promise<EventRaw[]> {
  const serpKey = Deno.env.get("SERPAPI_KEY");
  if (!serpKey) {
    console.warn(`[${AGENT_NAME}] SERPAPI_KEY not set — skipping Google Events`);
    return [];
  }

  const queries = [
    "אירועים ישראל השבוע",
    "פסטיבל קונצרט ישראל החודש",
    "מרתון ריצה ספורט ישראל",
  ];

  const results: EventRaw[] = [];

  for (const q of queries) {
    try {
      const url = `https://serpapi.com/search.json?engine=google_events&q=${encodeURIComponent(q)}&hl=iw&gl=il&api_key=${serpKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;

      const data: {
        events_results?: Array<{
          title: string;
          date?: { start_date?: string; when?: string };
          venue?: { name?: string };
          link?: string;
          description?: string;
        }>;
      } = await res.json();

      for (const ev of (data.events_results ?? [])) {
        if (!hasSectorOverlap(ev.title, ev.description ?? "")) continue;

        const rawDate = ev.date?.start_date ?? ev.date?.when ?? "";
        let eventDate: string;
        try {
          const d = new Date(rawDate);
          eventDate = isNaN(d.getTime())
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
            : d.toISOString().split("T")[0];
        } catch {
          eventDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        }

        results.push({
          event_name:      ev.title,
          event_date:      eventDate,
          geo:             "IL",
          source_url:      ev.link ?? "https://serpapi.com",
          detected_at_utc: new Date().toISOString(),
          confidence_score: 0.80,
        });
      }
    } catch (e) {
      console.warn(`[${AGENT_NAME}] SerpAPI Events query failed for "${q}":`, e);
    }
  }

  return results;
}

// ─── Source: Tavily — upcoming Israeli events ────────────────────────────────

async function fetchTavilyEvents(): Promise<EventRaw[]> {
  const tavilyKey = Deno.env.get("TAVILY_API_KEY");
  if (!tavilyKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:      tavilyKey,
        query:        "אירועים קרובים ישראל פסטיבל שוק מרתון",
        search_depth: "basic",
        max_results:  5,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const data: { results?: Array<{ title: string; url: string; content: string }> } = await res.json();

    return (data.results ?? [])
      .filter((r) => hasSectorOverlap(r.title, r.content))
      .map((r): EventRaw => ({
        event_name:      r.title.slice(0, 200),
        event_date:      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        geo:             "IL",
        source_url:      r.url,
        detected_at_utc: new Date().toISOString(),
        confidence_score: 0.70,
      }));
  } catch (e) {
    console.warn(`[${AGENT_NAME}] Tavily events failed:`, e);
    return [];
  }
}

// ─── Source: Hardcoded seasonal calendar (Israeli peaks) ─────────────────────

function buildSeasonalCalendar(): EventRaw[] {
  const year = new Date().getFullYear();
  const events: Array<{ name: string; month: number; day: number; geo: string | null; relevance: string }> = [
    { name: "פסח — שיא צריכה", month: 3, day: 15, geo: "IL", relevance: "restaurant local" },
    { name: "ראש השנה — שיא ביקוש", month: 9, day: 1, geo: "IL", relevance: "restaurant beauty local" },
    { name: "רמדאן — שיא ביקוש", month: 3, day: 1, geo: "bnei_brak", relevance: "restaurant local" },
    { name: "קיץ — שיא כושר", month: 6, day: 1, geo: "IL", relevance: "fitness beauty" },
    { name: "חנוכה — שיא מכירות", month: 12, day: 1, geo: "IL", relevance: "restaurant local" },
    { name: "יום העצמאות", month: 4, day: 26, geo: "IL", relevance: "restaurant local fitness" },
  ];

  const now = new Date();
  return events
    .map((e): EventRaw => {
      const eventDate = new Date(year, e.month - 1, e.day);
      const daysAhead = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAhead < 0 || daysAhead > 30) return null as unknown as EventRaw;

      if (!hasSectorOverlap(e.name, e.relevance)) return null as unknown as EventRaw;

      return {
        event_name: e.name,
        event_date: `${year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`,
        geo: e.geo,
        source_url: `https://calendar.google.com/calendar/r/search?q=${encodeURIComponent(e.name)}`,
        detected_at_utc: new Date().toISOString(),
        confidence_score: 0.80,
      };
    })
    .filter((e): e is EventRaw => e !== null);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const collected: EventRaw[] = [];

  // Partial source failures are acceptable — log and continue
  await fetchIsraeliHolidays()
    .then((r) => collected.push(...r))
    .catch((e) => {
      console.error(`[${AGENT_NAME}] HebCal failed:`, e.message);
      pingHeartbeat(AGENT_NAME, "ERROR", undefined, `HebCal: ${e.message}`).catch(console.error);
    });

  await fetchEventbrite()
    .then((r) => collected.push(...r))
    .catch((e) => {
      console.error(`[${AGENT_NAME}] Eventbrite failed:`, e.message);
      pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Eventbrite: ${e.message}`).catch(console.error);
    });

  await fetchSerpApiEvents()
    .then((r) => collected.push(...r))
    .catch((e) => {
      console.error(`[${AGENT_NAME}] SerpAPI Events failed:`, e.message);
    });

  await fetchTavilyEvents()
    .then((r) => collected.push(...r))
    .catch((e) => {
      console.error(`[${AGENT_NAME}] Tavily Events failed:`, e.message);
    });

  collected.push(...buildSeasonalCalendar());

  if (collected.length === 0) {
    console.log(`[${AGENT_NAME}] No events collected — nothing to upsert`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  // Upsert on (event_name, event_date, geo) — idempotent
  const { error } = await supabase
    .from("events_raw")
    .upsert(collected, { onConflict: "event_name,event_date,geo", ignoreDuplicates: false });

  if (error) {
    console.error(`[${AGENT_NAME}] Upsert failed:`, error.message);
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, error.message);
    return;
  }

  const now = new Date().toISOString();
  await pingHeartbeat(AGENT_NAME, "OK", now);
  console.log(`[${AGENT_NAME}] Done. Upserted ${collected.length} events. Ping: ${now}`);
}

if (import.meta.main) {
  await run();
}
