// OTXEngine — Agent 13: CrossSectorBridgeAgent
// Schedule: nightly at 02:00
// Output: cross_sector_signals
// Algorithm: Pearson correlation of sector trend vectors across 4 lag windows (0/3/7/14 days)

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "CrossSectorBridgeAgent";

const SECTORS = ["restaurant", "fitness", "beauty", "local"] as const;
type Sector = typeof SECTORS[number];

const LAG_DAYS = [0, 3, 7, 14];
const CORRELATION_THRESHOLD = 0.65; // minimum Pearson r to record a signal

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface DailyVolume {
  date: string;
  total_volume: number;
}

interface AiOpportunityDesc {
  trend_description: string;
  opportunity_description: string;
}

// ─── Pearson correlation ──────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  const meanX = xs.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanY = ys.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num  += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

// ─── Build sector trend vector (daily total signal volume) ────────────────────

async function buildTrendVector(sector: Sector, days: number): Promise<Map<string, number>> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Aggregate qualified classified_signals per day for all businesses in this sector.
  // classified_signals has business_id UUID FK → businesses(sector).
  const { data, error } = await supabase
    .from("classified_signals")
    .select("processed_at, intent_score, businesses!inner(sector)")
    .eq("businesses.sector", sector)
    .eq("qualified", true)
    .gte("processed_at", since.toISOString());

  if (error) throw error;

  const byDate = new Map<string, number>();
  for (const row of (data ?? []) as { processed_at: string; intent_score: number }[]) {
    const date = row.processed_at.split("T")[0];
    // Weight each signal by its intent_score (0–1 × 100 → synthetic volume)
    const vol = Math.round((row.intent_score ?? 0.5) * 100);
    byDate.set(date, (byDate.get(date) ?? 0) + vol);
  }

  return byDate;
}

// ─── Align two date-indexed vectors with optional lag ────────────────────────

function alignVectors(
  v1: Map<string, number>,
  v2: Map<string, number>,
  lagDays: number,
): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];

  // Sort v1 dates
  const dates = Array.from(v1.keys()).sort();

  for (const date of dates) {
    const laggedDate = new Date(date);
    laggedDate.setDate(laggedDate.getDate() + lagDays);
    const laggedKey = laggedDate.toISOString().split("T")[0];

    if (v2.has(laggedKey)) {
      xs.push(v1.get(date)!);
      ys.push(v2.get(laggedKey)!);
    }
  }

  return [xs, ys];
}

// ─── AI narrative for a detected correlation ──────────────────────────────────

async function generateNarrative(
  source: Sector,
  target: Sector,
  lagDays: number,
  correlation: number,
): Promise<AiOpportunityDesc> {
  const prompt = `
קורלציה בין מגזרים:
מגזר מקור: ${source} → מגזר יעד: ${target}
פיגור: ${lagDays} ימים | עוצמת קורלציה: ${correlation.toFixed(2)}

מה המשמעות של קורלציה זו לעסקים במגזר ${target}?
כיצד יכולים לנצל אותה?
ענה JSON בלבד:
{
  "trend_description": "תיאור הטרנד (משפט אחד)",
  "opportunity_description": "הזדמנות לעסקים במגזר היעד (2-3 משפטים)"
}
`;

  const raw = await callAnthropicAPI(prompt, 400);
  return parseAIJson<AiOpportunityDesc>(raw);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting nightly run at ${new Date().toISOString()}`);

  // Build 30-day trend vectors for all sectors
  const vectors = new Map<Sector, Map<string, number>>();
  for (const sector of SECTORS) {
    try {
      vectors.set(sector, await buildTrendVector(sector, 30));
      console.log(`[${AGENT_NAME}] Loaded ${vectors.get(sector)!.size} days of data for ${sector}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed to build vector for ${sector}:`, msg);
    }
  }

  let totalSignals = 0;
  let errorCount = 0;

  // Test all sector pairs × all lag windows
  for (const source of SECTORS) {
    for (const target of SECTORS) {
      if (source === target) continue;

      const v1 = vectors.get(source);
      const v2 = vectors.get(target);
      if (!v1 || !v2) continue;

      for (const lag of LAG_DAYS) {
        const [xs, ys] = alignVectors(v1, v2, lag);
        if (xs.length < 5) continue; // not enough data points

        const r = pearson(xs, ys);
        if (Math.abs(r) < CORRELATION_THRESHOLD) continue;

        console.log(`[${AGENT_NAME}] Correlation: ${source} → ${target} lag=${lag}d r=${r.toFixed(3)}`);

        // Check if we already recorded this correlation today
        const today = new Date().toISOString().split("T")[0];
        const { data: existing } = await supabase
          .from("cross_sector_signals")
          .select("id")
          .eq("source_sector", source)
          .eq("target_sector", target)
          .eq("lag_days", lag)
          .gte("detected_at_utc", `${today}T00:00:00Z`)
          .maybeSingle();

        if (existing) continue;

        try {
          const narrative = await generateNarrative(source, target, lag, r);

          const { error: insErr } = await supabase.from("cross_sector_signals").insert({
            source_sector:           source,
            target_sector:           target,
            trend_description:       narrative.trend_description,
            correlation_score:       parseFloat(r.toFixed(3)),
            lag_days:                lag,
            opportunity_description: narrative.opportunity_description,
            source_signal_ids:       [],
            source_url:              "internal://cross-sector-bridge",
            detected_at_utc:         new Date().toISOString(),
            confidence_score:        Math.min(0.92, 0.5 + Math.abs(r) * 0.5),
          });

          if (insErr) {
            console.error(`[${AGENT_NAME}] Insert failed:`, insErr.message);
            errorCount++;
          } else {
            totalSignals++;
            console.log(`[${AGENT_NAME}] ✓ ${source} → ${target} (lag=${lag}d): ${narrative.trend_description.slice(0, 60)}`);

            // Publish cross_sector_opportunity to bus → triggers ActionScoringService
            const { data: newRow } = await supabase
              .from("cross_sector_signals")
              .select("id")
              .eq("source_sector", source)
              .eq("target_sector", target)
              .eq("lag_days", lag)
              .order("detected_at_utc", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (newRow?.id) {
              // Find all businesses in target sector to notify
              const { data: bizList } = await supabase
                .from("businesses")
                .select("id")
                .eq("sector", target);
              for (const biz of (bizList ?? []) as { id: string }[]) {
                await publishToBus(supabase, {
                  business_id:    biz.id,
                  sourceAgent:    AGENT_NAME,
                  sourceRecordId: newRow.id as string,
                  sourceTable:    "cross_sector_signals",
                  event_type:     "cross_sector_opportunity",
                  payload: { source_sector: source, target_sector: target, correlation_score: r, lag_days: lag },
                }).catch(() => {/* non-critical */});
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[${AGENT_NAME}] AI narrative failed for ${source}→${target}:`, msg);
          errorCount++;
        }
      }
    }
  }

  const now = new Date().toISOString();
  await pingHeartbeat(
    AGENT_NAME,
    errorCount > 0 ? "DELAYED" : "OK",
    now,
    errorCount > 0 ? `${errorCount} errors` : undefined,
  );
  console.log(`[${AGENT_NAME}] Done. Signals recorded: ${totalSignals}, Errors: ${errorCount}. Ping: ${now}`);
}

// deno-lint-ignore no-explicit-any
export async function runCrossSectorBridgeAgent(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
