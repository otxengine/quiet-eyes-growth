// OTXEngine — Agent 21: ServiceExpansionScout
// Schedule: Weekly on Sundays at 04:00
// Output: expansion_opportunities → publishes 'expansion_opportunity_detected' to bus
// Mission: Surface unmet local demand patterns to guide service expansion decisions.
// Invariant: minimum 5 signals per cluster — no false positives. Skips 'hard' feasibility.

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson, getEmbedding } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";
import { buildEnrichedContext } from "./orchestration/context_builder.ts";
import type { EnrichedContext, DemandCluster } from "./orchestration/types.ts";

const AGENT_NAME = "ServiceExpansionScout";
const MIN_CLUSTER_SIZE = 5;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface UnmetDemandSignal {
  id:     string;
  text:   string;
  url:    string;
  source: string;
}

interface ExpansionOpportunityAI {
  opportunity_title:                string;
  description:                      string;
  feasibility:                      "easy" | "medium" | "hard";
  estimated_monthly_revenue_ils:    number;
  estimated_investment_ils:         number;
  roi_months:                       number;
  first_step:                       string;
  lead_examples:                    string[];
}

// ─── Unmet demand collection ──────────────────────────────────────────────────

async function findUnmetDemand(
  geoCity: string,
  sector: string,
  keywords: string[],
): Promise<UnmetDemandSignal[]> {
  const serpApiKey = Deno.env.get("SERPAPI_KEY");
  if (!serpApiKey) {
    console.warn(`[${AGENT_NAME}] SERPAPI_KEY not set — no signals`);
    return [];
  }

  const signals: UnmetDemandSignal[] = [];
  const searchTerms = [
    `"${geoCity}" "${sector}" "מישהו מכיר" OR "מחפש" OR "האם יש"`,
    ...(keywords ?? []).slice(0, 3).map((kw) => `"${geoCity}" "${kw}" "לא מצאתי" OR "חיפשתי"`),
  ];

  for (const term of searchTerms) {
    try {
      const query = encodeURIComponent(term);
      const res = await fetch(
        `https://serpapi.com/search.json?engine=google&q=${query}&api_key=${serpApiKey}&num=10`,
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic_results ?? []).slice(0, 10)) {
        if (!r.snippet) continue;
        signals.push({
          id:     crypto.randomUUID(),
          text:   r.snippet,
          url:    r.link ?? "",
          source: "serpapi",
        });
      }
    } catch {
      continue;
    }
  }

  return signals;
}

// ─── Semantic clustering via embeddings ──────────────────────────────────────

async function clusterUnmetDemand(
  signals: UnmetDemandSignal[],
): Promise<DemandCluster[]> {
  if (signals.length < MIN_CLUSTER_SIZE) return [];

  // Embed all signal texts
  const embeddings: number[][] = [];
  for (const sig of signals) {
    try {
      const vec = await getEmbedding(sig.text.slice(0, 500));
      embeddings.push(vec);
    } catch {
      embeddings.push([]);
    }
  }

  // Simple cosine similarity clustering (k=3 centroids, 2-pass)
  const validPairs = signals
    .map((s, i) => ({ signal: s, embedding: embeddings[i] }))
    .filter((p) => p.embedding.length > 0);

  if (validPairs.length < MIN_CLUSTER_SIZE) return [];

  // Greedy clustering: group by cosine similarity > 0.75
  const clusters: DemandCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < validPairs.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: DemandCluster = {
      topic:        validPairs[i].signal.text.slice(0, 80),
      signal_count: 1,
      examples:     [validPairs[i].signal.text],
      signal_ids:   [validPairs[i].signal.id],
      source_urls:  [validPairs[i].signal.url],
    };
    assigned.add(i);

    for (let j = i + 1; j < validPairs.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSim(validPairs[i].embedding, validPairs[j].embedding);
      if (sim > 0.72) {
        cluster.signal_count++;
        cluster.examples.push(validPairs[j].signal.text);
        cluster.signal_ids.push(validPairs[j].signal.id);
        cluster.source_urls.push(validPairs[j].signal.url);
        assigned.add(j);
      }
    }

    if (cluster.signal_count >= MIN_CLUSTER_SIZE) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || b.length !== a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Main agent logic ─────────────────────────────────────────────────────────

export async function runServiceExpansionScout(
  _supabase: typeof supabase,
  context: EnrichedContext,
): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting weekly scan for business ${context.business.id}`);

  const keywords = context.metaConfig?.signal_keywords ?? [];
  const signals  = await findUnmetDemand(
    context.business.geo_city,
    context.business.sector,
    keywords,
  );

  if (signals.length < MIN_CLUSTER_SIZE) {
    console.log(`[${AGENT_NAME}] Not enough signals (${signals.length}) — skipping`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  const clusters = await clusterUnmetDemand(signals);

  if (clusters.length === 0) {
    console.log(`[${AGENT_NAME}] No clusters with >= ${MIN_CLUSTER_SIZE} signals`);
    await pingHeartbeat(AGENT_NAME, "OK");
    return;
  }

  let opportunitiesWritten = 0;
  let lastRecordId = "";

  for (const cluster of clusters) {
    const opportunityPrompt = `
זוהו ${cluster.signal_count} שאלות ללא מענה על:
"${cluster.topic}"

דוגמאות:
${cluster.examples.slice(0, 3).join("\n")}

עסק קיים: ${context.business.sector} ב${context.business.geo_city}

JSON:
{
  "opportunity_title": "שם ההזדמנות — עד 6 מילים",
  "description": "תיאור הפער — עד 20 מילה",
  "feasibility": "medium",
  "estimated_monthly_revenue_ils": 15000,
  "estimated_investment_ils": 5000,
  "roi_months": 4,
  "first_step": "צעד ראשון קונקרטי — עד 10 מילים",
  "lead_examples": ["תיאור ליד 1", "תיאור ליד 2", "תיאור ליד 3"]
}
    `.trim();

    let opportunity: ExpansionOpportunityAI | null = null;
    try {
      const raw = await callAnthropicAPI(opportunityPrompt, 800);
      opportunity = parseAIJson<ExpansionOpportunityAI>(raw);
    } catch (e) {
      console.warn(`[${AGENT_NAME}] Opportunity generation failed:`, e);
      continue;
    }

    // Skip hard opportunities — too risky for SMBs
    if (opportunity.feasibility === "hard") continue;

    const confidenceScore = Math.min(cluster.signal_count / 20, 0.95);

    const { data: row, error } = await supabase
      .from("expansion_opportunities")
      .insert({
        business_id:               context.business.id,
        opportunity_title:         opportunity.opportunity_title,
        unmet_demand_description:  opportunity.description,
        demand_signal_count:       cluster.signal_count,
        geo:                       context.business.geo_city,
        estimated_monthly_revenue: opportunity.estimated_monthly_revenue_ils,
        estimated_investment:      opportunity.estimated_investment_ils,
        roi_months:                opportunity.roi_months,
        lead_examples:             opportunity.lead_examples,
        source_signal_ids:         cluster.signal_ids,
        source_url:                cluster.source_urls[0] ?? "internal://expansion-scout",
        confidence_score:          confidenceScore,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`[${AGENT_NAME}] Insert failed:`, error.message);
      continue;
    }

    lastRecordId = row?.id ?? "";
    opportunitiesWritten++;

    await publishToBus(supabase, {
      business_id:    context.business.id,
      sourceAgent:    AGENT_NAME,
      sourceRecordId: lastRecordId,
      sourceTable:    "expansion_opportunities",
      event_type:     "expansion_opportunity_detected",
      payload: {
        opportunity_title:   opportunity.opportunity_title,
        demand_signal_count: cluster.signal_count,
        feasibility:         opportunity.feasibility,
        confidence_score:    confidenceScore,
      },
    });
  }

  await pingHeartbeat(AGENT_NAME, "OK");
  console.log(
    `[${AGENT_NAME}] Done — ${opportunitiesWritten} opportunities from ${clusters.length} clusters`,
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const businesses: Array<{ id: string }> = await supabase
    .from("businesses")
    .select("id")
    .then(({ data }) => data ?? []);

  for (const biz of businesses) {
    const ctx = await buildEnrichedContext(supabase, biz.id, "scheduled");
    if (ctx) await runServiceExpansionScout(supabase, ctx);
  }
}
