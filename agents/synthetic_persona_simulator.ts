// OTXEngine — Agent 14: SyntheticPersonaSimulator
// Schedule: weekly (Sunday 03:00)
// Output: synthetic_personas
// Algorithm: k-means clustering on signal feature vectors (k=3, min 30 signals)
// + Anthropic persona generation + OpenAI embedding for similarity search

import { supabase } from "./lib/supabase.ts";
import { pingHeartbeat } from "./lib/heartbeat.ts";
import { callAnthropicAPI, parseAIJson, getEmbedding } from "./lib/anthropic.ts";
import { publishToBus } from "./orchestration/bus_publisher.ts";

const AGENT_NAME = "SyntheticPersonaSimulator";

const K_CLUSTERS = 3;
const MIN_SIGNALS = 30;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  sector: string;
  geo_city: string;
  price_tier: string | null;
}

interface SignalRow {
  keyword: string;
  volume: number;
  sentiment: number | null;
  intent_score: number | null;
  source: string;
  observed_at: string;
}

interface FeatureVector {
  volume: number;
  sentiment: number;
  intent: number;
  recency: number;   // days since observed (0 = today)
}

interface Cluster {
  centroid: FeatureVector;
  members: SignalRow[];
  label: string;    // high-intent / medium-intent / low-intent
}

interface AiPersona {
  persona_name: string;
  demographic_profile: {
    age_range: string;
    gender_distribution: string;
    income_level: string;
    location: string;
    occupation: string;
  };
  behavioral_traits: {
    purchase_triggers: string[];
    preferred_channels: string[];
    price_sensitivity: string;
    decision_speed: string;
    loyalty_tendency: string;
  };
  simulated_conversion_rate: number;
  simulated_response: {
    to_promotion: string;
    to_social_proof: string;
    to_urgency: string;
  };
}

// ─── Feature extraction ───────────────────────────────────────────────────────

const now = new Date();

function extractFeatures(signal: SignalRow): FeatureVector {
  const daysSince = Math.max(0, (now.getTime() - new Date(signal.observed_at).getTime()) / 86_400_000);
  return {
    volume:    Math.min(1, signal.volume / 1000),           // normalize 0-1
    sentiment: (signal.sentiment ?? 0.5),                   // already 0-1
    intent:    (signal.intent_score ?? 0.5),                // already 0-1
    recency:   Math.max(0, 1 - daysSince / 30),             // 1=today, 0=30d ago
  };
}

// ─── k-Means clustering ───────────────────────────────────────────────────────

function euclidean(a: FeatureVector, b: FeatureVector): number {
  return Math.sqrt(
    (a.volume - b.volume) ** 2 +
    (a.sentiment - b.sentiment) ** 2 +
    (a.intent - b.intent) ** 2 +
    (a.recency - b.recency) ** 2,
  );
}

function centroidOf(vecs: FeatureVector[]): FeatureVector {
  const n = vecs.length;
  return {
    volume:    vecs.reduce((s, v) => s + v.volume, 0) / n,
    sentiment: vecs.reduce((s, v) => s + v.sentiment, 0) / n,
    intent:    vecs.reduce((s, v) => s + v.intent, 0) / n,
    recency:   vecs.reduce((s, v) => s + v.recency, 0) / n,
  };
}

function kMeans(signals: SignalRow[], k: number): Cluster[] {
  const features = signals.map(extractFeatures);

  // k-Means++ seeding
  const centroids: FeatureVector[] = [features[Math.floor(Math.random() * features.length)]];
  while (centroids.length < k) {
    const dists = features.map((f) => Math.min(...centroids.map((c) => euclidean(f, c))));
    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total;
    let chosen = features[features.length - 1];
    for (let i = 0; i < features.length; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = features[i]; break; }
    }
    centroids.push(chosen);
  }

  // Iterate up to 20 rounds
  let assignments = new Array<number>(signals.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    const newAssignments = features.map((f) => {
      let bestIdx = 0, bestDist = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const d = euclidean(f, centroids[ci]);
        if (d < bestDist) { bestDist = d; bestIdx = ci; }
      }
      return bestIdx;
    });

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids
    for (let ci = 0; ci < k; ci++) {
      const members = features.filter((_, i) => assignments[i] === ci);
      if (members.length > 0) centroids[ci] = centroidOf(members);
    }
  }

  // Build cluster objects
  const clusters: Cluster[] = Array.from({ length: k }, (_, ci) => {
    const members = signals.filter((_, i) => assignments[i] === ci);
    const memberFeatures = features.filter((_, i) => assignments[i] === ci);
    const centroid = memberFeatures.length > 0 ? centroidOf(memberFeatures) : centroids[ci];
    return { centroid, members, label: "" };
  });

  // Label clusters by intent level
  const sorted = clusters
    .map((c, idx) => ({ idx, score: c.centroid.intent * 0.5 + c.centroid.recency * 0.3 + c.centroid.volume * 0.2 }))
    .sort((a, b) => b.score - a.score);

  const labels = ["high-intent", "medium-intent", "low-intent"];
  sorted.forEach((s, rank) => { clusters[s.idx].label = labels[rank] ?? "low-intent"; });

  return clusters.filter((c) => c.members.length > 0);
}

// ─── AI persona generation ────────────────────────────────────────────────────

async function generatePersona(
  biz: Business,
  cluster: Cluster,
): Promise<AiPersona> {
  const topKeywords = cluster.members
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8)
    .map((s) => s.keyword)
    .join(", ");

  const prompt = `
עסק: ${biz.name} | סקטור: ${biz.sector} | עיר: ${biz.geo_city} | מחיר: ${biz.price_tier ?? "mid"}
מאפיין אשכול: ${cluster.label}
נפח ממוצע: ${(cluster.centroid.volume * 1000).toFixed(0)} | כוונת רכישה: ${(cluster.centroid.intent * 100).toFixed(0)}% | סנטימנט: ${(cluster.centroid.sentiment * 100).toFixed(0)}%
מילות מפתח מובילות: ${topKeywords}

צור פרסונת לקוח סינתטית עבור אשכול זה.
ענה JSON בלבד:
{
  "persona_name": "שם פרסונה (עברית, עד 3 מילים)",
  "demographic_profile": {
    "age_range": "25-35",
    "gender_distribution": "60% נשים / 40% גברים",
    "income_level": "בינוני-גבוה",
    "location": "פרברי ${biz.geo_city}",
    "occupation": "תיאור תעסוקה"
  },
  "behavioral_traits": {
    "purchase_triggers": ["טריגר1","טריגר2","טריגר3"],
    "preferred_channels": ["ערוץ1","ערוץ2"],
    "price_sensitivity": "נמוכה|בינונית|גבוהה",
    "decision_speed": "מהיר|בינוני|איטי",
    "loyalty_tendency": "נאמן|מוחלף|מסחרי"
  },
  "simulated_conversion_rate": 0.18,
  "simulated_response": {
    "to_promotion": "תגובה למבצע",
    "to_social_proof": "תגובה להמלצות",
    "to_urgency": "תגובה לתחושת דחיפות"
  }
}
`;

  const raw = await callAnthropicAPI(prompt, 800);
  return parseAIJson<AiPersona>(raw);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`[${AGENT_NAME}] Starting weekly run at ${new Date().toISOString()}`);

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier");

  if (bizErr) {
    await pingHeartbeat(AGENT_NAME, "ERROR", undefined, bizErr.message);
    return;
  }

  let totalPersonas = 0;
  let errorCount = 0;

  for (const biz of (businesses ?? []) as Business[]) {
    try {
      // Load 30-day signals from classified_signals (agent-native table with business_id UUID FK)
      const since30d = new Date();
      since30d.setDate(since30d.getDate() - 30);

      const { data: rawSigs, error: sigErr } = await supabase
        .from("classified_signals")
        .select("intent_score, confidence_score, processed_at, source_url")
        .eq("business_id", biz.id)
        .eq("qualified", true)
        .gte("processed_at", since30d.toISOString())
        .order("processed_at", { ascending: false })
        .limit(500);

      if (sigErr) throw sigErr;

      // Map to the SignalRow interface used by k-means clustering
      const sigList: SignalRow[] = ((rawSigs ?? []) as {
        intent_score: number; confidence_score: number; processed_at: string; source_url: string;
      }[]).map((r) => ({
        keyword:      r.source_url.replace(/https?:\/\/[^/]+/, "").split("/").filter(Boolean)[0] ?? "signal",
        volume:       Math.round((r.confidence_score ?? 0.5) * 100),
        sentiment:    null,
        intent_score: r.intent_score ?? 0.5,
        source:       new URL(r.source_url).hostname.replace("www.", ""),
        observed_at:  r.processed_at,
      }));
      if (sigList.length < MIN_SIGNALS) {
        console.log(`[${AGENT_NAME}] ${biz.name}: only ${sigList.length} signals (need ${MIN_SIGNALS}) — skipping`);
        continue;
      }

      console.log(`[${AGENT_NAME}] ${biz.name}: clustering ${sigList.length} signals into ${K_CLUSTERS} personas`);
      const clusters = kMeans(sigList, K_CLUSTERS);

      for (const cluster of clusters) {
        if (cluster.members.length < 5) continue; // tiny cluster — skip

        let persona: AiPersona;
        try {
          persona = await generatePersona(biz, cluster);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[${AGENT_NAME}] Persona AI failed for ${biz.name}/${cluster.label}: ${msg}`);
          continue;
        }

        // Get embedding for the persona name + behavioral traits description
        const embeddingText = [
          persona.persona_name,
          ...persona.behavioral_traits.purchase_triggers,
          ...persona.behavioral_traits.preferred_channels,
          persona.behavioral_traits.price_sensitivity,
        ].join(" ");

        let embeddingVector: number[] | null = null;
        try {
          embeddingVector = await getEmbedding(embeddingText);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[${AGENT_NAME}] Embedding failed for ${persona.persona_name}: ${msg}`);
        }

        const osintBasis = cluster.members
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 10)
          .map((s) => `${s.keyword}@${s.source}`);

        const { error: insErr } = await supabase.from("synthetic_personas").insert({
          business_id:               biz.id,
          persona_name:              persona.persona_name,
          demographic_profile:       persona.demographic_profile,
          behavioral_traits:         persona.behavioral_traits,
          osint_basis:               osintBasis,
          simulated_conversion_rate: Math.max(0, Math.min(1, persona.simulated_conversion_rate)),
          simulated_response:        persona.simulated_response,
          embedding_vector:          embeddingVector,
          computed_at:               new Date().toISOString(),
          source_url:                "internal://persona-simulator",
        });

        if (insErr) {
          console.error(`[${AGENT_NAME}] Insert failed:`, insErr.message);
          errorCount++;
        } else {
          totalPersonas++;
          console.log(
            `[${AGENT_NAME}] ✓ ${biz.name} → "${persona.persona_name}" ` +
            `(${cluster.label}, conv=${(persona.simulated_conversion_rate * 100).toFixed(1)}%)`,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${AGENT_NAME}] Failed for ${biz.id}:`, msg);
      await pingHeartbeat(AGENT_NAME, "ERROR", undefined, `Persona failed for ${biz.id}: ${msg}`);
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
  console.log(`[${AGENT_NAME}] Done. Personas created: ${totalPersonas}, Errors: ${errorCount}. Ping: ${nowIso}`);

  // Publish persona_updated per business that got new personas → triggers ActionScoringService
  if (totalPersonas > 0) {
    const { data: allBizIds } = await supabase
      .from("synthetic_personas")
      .select("business_id")
      .gte("computed_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    const seen = new Set<string>();
    for (const row of (allBizIds ?? []) as { business_id: string }[]) {
      if (seen.has(row.business_id)) continue;
      seen.add(row.business_id);
      await publishToBus(supabase, {
        business_id:    row.business_id,
        sourceAgent:    AGENT_NAME,
        sourceRecordId: crypto.randomUUID(),
        sourceTable:    "synthetic_personas",
        event_type:     "persona_updated",
        payload:        { personas_count: totalPersonas },
      }).catch(() => {/* non-critical */});
    }
  }
}

// deno-lint-ignore no-explicit-any
export async function runSyntheticPersonaSimulator(_supabase?: unknown, _context?: any): Promise<void> {
  await run();
}

if (import.meta.main) {
  await run();
}
