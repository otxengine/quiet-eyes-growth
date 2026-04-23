// OTXEngine — Agent 10: HyperLocalContextAgent
// Schedule: every 12 hours (after local_event_anticipator)
// Output: hyper_local_events.digital_signal_match (update) + resource_arbitrage_actions
// Purpose: Cross-reference physical events with OSINT digital signals → AI opportunity

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";

const AGENT_NAME = "HyperLocalContextAgent";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  sector: string;
  geo_city: string;
}

interface HyperLocalEvent {
  id: string;
  event_name: string;
  event_type: string;
  venue_name: string | null;
  distance_meters: number;
  event_datetime: string;
  expected_attendance: number | null;
  confidence_score: number;
  source_url: string;
}

interface SignalRow {
  id: string;
  keyword: string;
  volume: number;
  sentiment: number | null;
  source: string;
  observed_at: string;
}

interface MetaConfig {
  signal_keywords: string[];
  local_radius_meters: number;
}

interface AiOpportunity {
  digital_signal_match: string;
  recommended_action: string;
  action_type: "promotion" | "coupon" | "menu_change" | "staffing" | "delivery_push";
  target_segment: string;
  expected_uplift_pct: number;
  confidence: number;
}

// ─── Match signals to event keywords ─────────────────────────────────────────

function matchSignalsToEvent(
  signals: SignalRow[],
  event: HyperLocalEvent,
  keywords: string[],
): SignalRow[] {
  const eventWords = event.event_name.toLowerCase().split(/\s+/);
  const matchedSignals: SignalRow[] = [];

  for (const signal of signals) {
    const sigWord = signal.keyword.toLowerCase();
    // Match if signal keyword appears in event name or config keywords
    const inEvent   = eventWords.some((w) => w.includes(sigWord) || sigWord.includes(w));
    const inKeyword = keywords.some((kw) => kw.toLowerCase().includes(sigWord) || sigWord.includes(kw.toLowerCase()));
    if (inEvent || inKeyword) {
      matchedSignals.push(signal);
    }
  }

  return matchedSignals;
}

// ─── AI opportunity generation ────────────────────────────────────────────────

async function generateOpportunity(
  biz: Business,
  event: HyperLocalEvent,
  matchedSignals: SignalRow[],
): Promise<AiOpportunity> {
  const signalSummary = matchedSignals
    .slice(0, 5)
    .map((s) => `"${s.keyword}" (vol: ${s.volume}, sentiment: ${s.sentiment?.toFixed(2) ?? "N/A"})`)
    .join(", ");

  const prompt = `
עסק: ${biz.name} | סקטור: ${biz.sector} | עיר: ${biz.geo_city}
אירוע מקומי: ${event.event_name} (${event.event_type}) בעוד ${Math.round(event.distance_meters)}מ'
תאריך אירוע: ${new Date(event.event_datetime).toLocaleString("he-IL")}
צפי קהל: ${event.expected_attendance ?? "לא ידוע"}
אותות דיגיטליים תואמים: ${signalSummary || "ללא"}

על סמך האירוע המקומי והאותות הדיגיטליים, מה ההזדמנות לעסק?
ענה JSON בלבד:
{
  "digital_signal_match": "תיאור קצר של הקשר בין האירוע לאות הדיגיטלי",
  "recommended_action": "פעולה ספציפית שהעסק יכול לנקוט (עד 3 משפטים)",
  "action_type": "promotion|coupon|menu_change|staffing|delivery_push",
  "target_segment": "פלח לקוחות יעד",
  "expected_uplift_pct": 15,
  "confidence": 0.78
}
`;

  const raw = await callAnthropicAPI(prompt, 512);
  return parseAIJson<AiOpportunity>(raw);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  // Load meta_configurations for keywords
  const { data: metaRows } = await supabase
    .from("meta_configurations")
    .select("business_id, signal_keywords, local_radius_meters");

  const metaMap = new Map<string, MetaConfig>(
    ((metaRows ?? []) as (MetaConfig & { business_id: string })[]).map(
      (r) => [r.business_id, { signal_keywords: r.signal_keywords, local_radius_meters: r.local_radius_meters }],
    ),
  );

  let totalOpportunities = 0;
  let errorCount = 0;

  const now72h = new Date();
  now72h.setHours(now72h.getHours() + 72);

  for (const biz of (businesses ?? []) as Business[]) {
    try {
      // Load upcoming events for this business
      const { data: events, error: evErr } = await supabase
        .from("hyper_local_events")
        .select("id, event_name, event_type, venue_name, distance_meters, event_datetime, expected_attendance, confidence_score, source_url")
        .eq("business_id", biz.id)
        .gte("event_datetime", new Date().toISOString())
        .lte("event_datetime", now72h.toISOString())
        .order("event_datetime");

      if (evErr) throw evErr;
      if (!events || events.length === 0) continue;

      // Load recent signals for this business (last 48h)
      const since48h = new Date();
      since48h.setHours(since48h.getHours() - 48);

      const { data: signals } = await supabase
        .from("market_signals")
        .select("id, keyword, volume, sentiment, source, observed_at")
        .eq("business_id", biz.id)
        .gte("observed_at", since48h.toISOString())
        .order("volume", { ascending: false })
        .limit(50);

      const meta = metaMap.get(biz.id);
      const keywords = meta?.signal_keywords ?? [];

      for (const event of events as HyperLocalEvent[]) {
        // Skip events already processed (digital_signal_match already set)
        // We detect this by checking if resource_arbitrage_actions already has an entry
        const { data: existingAction } = await supabase
          .from("resource_arbitrage_actions")
          .select("id")
          .eq("business_id", biz.id)
          .eq("trigger_type", "low_demand")
          .gte("valid_from", event.event_datetime)
          .limit(1)
          .maybeSingle();

        // Allow up to 1 event-driven action per event per business
        if (existingAction) continue;

        const matchedSignals = matchSignalsToEvent(
          (signals ?? []) as SignalRow[],
          event,
          keywords,
        );

        let opportunity: AiOpportunity;
        try {
          opportunity = await generateOpportunity(biz, event, matchedSignals);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[${AGENT_NAME}] AI failed for event "${event.event_name}": ${msg}`);
          continue;
        }

        // Update digital_signal_match on the event row
        await supabase
          .from("hyper_local_events")
          .update({ digital_signal_match: opportunity.digital_signal_match })
          .eq("id", event.id);

        // Insert opportunity into resource_arbitrage_actions
        const eventDt = new Date(event.event_datetime);
        const validUntil = new Date(eventDt.getTime() + 3 * 60 * 60 * 1000);

        const { error: insErr } = await supabase.from("resource_arbitrage_actions").insert({
          business_id:         biz.id,
          trigger_type:        "competitor_gap",
          trigger_description: `אירוע מקומי: ${event.event_name} (${event.distance_meters}מ' מהעסק)`,
          recommended_action:  opportunity.recommended_action,
          action_type:         opportunity.action_type,
          target_segment:      opportunity.target_segment,
          expected_uplift_pct: opportunity.expected_uplift_pct,
          valid_from:          new Date(eventDt.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          valid_until:         validUntil.toISOString(),
          executed:            false,
          source_url:          event.source_url,
          detected_at_utc:     new Date().toISOString(),
          confidence_score:    Math.min(0.95, opportunity.confidence),
        });

        if (insErr) {
          console.error(`[${AGENT_NAME}] Insert failed:`, insErr.message);
          errorCount++;
        } else {
          totalOpportunities++;
          console.log(
            `[${AGENT_NAME}] ✓ ${biz.name} | "${event.event_name}" → ` +
            `${opportunity.action_type} +${opportunity.expected_uplift_pct}%`,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed for ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Context failed for ${biz.id}: ${msg}`);
      errorCount++;
    }
  }

  const nowIso = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    nowIso,
    errorCount > 0 ? `${errorCount} errors` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Opportunities: ${totalOpportunities}, Errors: ${errorCount}. Ping: ${nowIso}`);
}

// deno-lint-ignore no-explicit-any
export async function runHyperLocalContextAgent(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
