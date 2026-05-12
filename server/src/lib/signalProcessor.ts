/**
 * signalProcessor.ts — OTX-002
 * Multi-layer signal processing pipeline:
 *   1. Normalize raw signals into unified SignalObject schema
 *   2. Fuse related signals by temporal / geographic / semantic correlation
 *   3. Score candidate actions using dynamically weighted parameters
 *   4. Update weights adaptively based on observed outcomes
 */

import { prisma } from '../db';

// ── Unified Signal Object ─────────────────────────────────────────────────────
export interface SignalObject {
  id:             string;
  businessId:     string;
  source:         string;    // originating agent / source type
  category:       string;    // signal category
  summary:        string;    // human-readable description
  confidence:     number;    // 0–100
  impact:         'high' | 'medium' | 'low';
  contextAttrs: {
    city?:        string;
    sector?:      string;
    geographic?:  string;
    temporal?:    string;   // ISO date string
    tags?:        string[];
  };
  rawPayload?:    Record<string, any>;
  detectedAt:     string;
}

// ── Candidate Action ──────────────────────────────────────────────────────────
export interface CandidateAction {
  type:          string;   // 'social_post'|'whatsapp_send'|'campaign'|'review_reply'
  label:         string;
  description:   string;
  prefilledText?: string;
  score:         number;   // 0–100 after scoring function
  scoringBreakdown: {
    recency:        number;
    sourceWeight:   number;
    sectorRelevance: number;
    crowdImpact:    number;
    feedbackBonus:  number;
  };
}

// ── Default scoring weights ───────────────────────────────────────────────────
const DEFAULT_WEIGHTS = {
  recency:         0.25,  // freshness of signal
  sourceWeight:    0.20,  // reliability of source (tavily=0.7, calendar=1.0, review=0.9)
  sectorRelevance: 0.30,  // how relevant to this business sector
  crowdImpact:     0.15,  // expected crowd / traffic impact
  feedbackBonus:   0.10,  // historical feedback for this signal category
};

const SOURCE_RELIABILITY: Record<string, number> = {
  event_calendar:    100,
  google_review:     95,
  tavily_search:     70,
  tavily_local_search: 72,
  social:            65,
  manual:            80,
};

// ── 1. Normalize a MarketSignal into unified SignalObject ─────────────────────
export function normalizeSignal(raw: any): SignalObject {
  let sourceDesc: any = {};
  try { sourceDesc = JSON.parse(raw.source_description || '{}'); } catch {}

  return {
    id:         raw.id,
    businessId: raw.linked_business || '',
    source:     raw.source_signals || raw.source_type || 'unknown',
    category:   raw.category || 'general',
    summary:    raw.summary || '',
    confidence: raw.confidence || 50,
    impact:     (raw.impact_level as any) || 'medium',
    contextAttrs: {
      city:      sourceDesc.city || undefined,
      sector:    sourceDesc.sector || undefined,
      geographic: sourceDesc.venue || undefined,
      temporal:  sourceDesc.event_date || raw.detected_at || undefined,
      tags:      raw.tags ? raw.tags.split(',').map((t: string) => t.trim()) : [],
    },
    rawPayload:  sourceDesc,
    detectedAt:  raw.detected_at || raw.created_date || new Date().toISOString(),
  };
}

// ── 2. Fuse related signals ───────────────────────────────────────────────────
// Groups signals by temporal (24h window) + semantic (same category) correlation.
export function fuseSignals(signals: SignalObject[]): SignalObject[][] {
  if (signals.length === 0) return [];

  const groups: SignalObject[][] = [];
  const assigned = new Set<string>();

  for (const signal of signals) {
    if (assigned.has(signal.id)) continue;

    const group: SignalObject[] = [signal];
    assigned.add(signal.id);

    const signalTime = new Date(signal.detectedAt).getTime();
    const signalCat  = signal.category;

    for (const other of signals) {
      if (assigned.has(other.id)) continue;

      // Temporal correlation: within 24h
      const otherTime = new Date(other.detectedAt).getTime();
      const temporallyClose = Math.abs(signalTime - otherTime) < 24 * 3600 * 1000;

      // Semantic correlation: same category or overlapping tags
      const sameCat = other.category === signalCat;
      const tagsOverlap = (signal.contextAttrs.tags || []).some(t =>
        (other.contextAttrs.tags || []).includes(t)
      );

      // Geographic correlation: same city/venue
      const sameGeo = signal.contextAttrs.city &&
        other.contextAttrs.city === signal.contextAttrs.city;

      if (temporallyClose && (sameCat || tagsOverlap || sameGeo)) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

// ── 3. Score candidate actions ────────────────────────────────────────────────
export async function scoreCandidateActions(
  candidates: Array<Omit<CandidateAction, 'score' | 'scoringBreakdown'>>,
  signal: SignalObject,
  businessId: string
): Promise<CandidateAction[]> {
  // Load adaptive weights from BusinessMemory
  let weights = { ...DEFAULT_WEIGHTS };
  try {
    const memory = await prisma.businessMemory.findFirst({ where: { linked_business: businessId } });
    if (memory?.agent_weights) {
      const saved = JSON.parse(memory.agent_weights);
      weights = { ...weights, ...saved };
    }
  } catch {}

  // Compute per-component scores
  const now = Date.now();
  const signalAge = (now - new Date(signal.detectedAt).getTime()) / (3600 * 1000); // hours
  const recencyScore = Math.max(0, 100 - signalAge * 2); // decays by 2pts/hour

  const sourceScore = SOURCE_RELIABILITY[signal.source] ?? 60;

  const sectorScore = (() => {
    if (signal.impact === 'high')   return 90;
    if (signal.impact === 'medium') return 65;
    return 40;
  })();

  const crowdScore = signal.confidence;

  // Feedback bonus: check AgentLearningProfile for this signal category
  let feedbackBonus = 50;
  try {
    const profile = await prisma.agentLearningProfile.findFirst({
      where: { linked_business: businessId, agent_name: signal.source },
    });
    if (profile && profile.total_outputs && profile.total_outputs > 0) {
      feedbackBonus = ((profile.positive_count || 0) / profile.total_outputs) * 100;
    }
  } catch {}

  return candidates.map(c => {
    const breakdown = {
      recency:         recencyScore,
      sourceWeight:    sourceScore,
      sectorRelevance: sectorScore,
      crowdImpact:     crowdScore,
      feedbackBonus,
    };

    const score = Math.round(
      breakdown.recency         * weights.recency +
      breakdown.sourceWeight    * weights.sourceWeight +
      breakdown.sectorRelevance * weights.sectorRelevance +
      breakdown.crowdImpact     * weights.crowdImpact +
      breakdown.feedbackBonus   * weights.feedbackBonus
    );

    return { ...c, score, scoringBreakdown: breakdown };
  }).sort((a, b) => b.score - a.score);
}

// ── 4. Adaptive weight update ─────────────────────────────────────────────────
// Called after an outcome is observed (action was accepted / dismissed).
export async function updateWeights(
  businessId: string,
  outcome: 'accepted' | 'dismissed',
  signal: SignalObject
) {
  try {
    const memory = await prisma.businessMemory.findFirst({ where: { linked_business: businessId } });
    let weights = { ...DEFAULT_WEIGHTS };
    if (memory?.agent_weights) {
      try { weights = { ...weights, ...JSON.parse(memory.agent_weights) }; } catch {}
    }

    // Adjust weights based on outcome
    // If action was accepted with a high-impact signal → boost crowdImpact weight
    // If action was dismissed → reduce weight of the source that generated it
    const delta = outcome === 'accepted' ? 0.02 : -0.02;

    if (signal.impact === 'high') {
      weights.crowdImpact = Math.min(0.5, Math.max(0.05, weights.crowdImpact + delta));
    }
    if (outcome === 'dismissed') {
      weights.sourceWeight = Math.min(0.5, Math.max(0.05, weights.sourceWeight + delta));
    }
    if (outcome === 'accepted') {
      weights.sectorRelevance = Math.min(0.5, Math.max(0.05, weights.sectorRelevance + delta));
    }

    // Normalize weights to sum to 1.0
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    if (total > 0) {
      Object.keys(weights).forEach(k => {
        (weights as any)[k] = Math.round(((weights as any)[k] / total) * 100) / 100;
      });
    }

    await prisma.businessMemory.upsert({
      where: { linked_business: businessId },
      update: {
        agent_weights: JSON.stringify(weights),
        last_updated:  new Date().toISOString(),
      },
      create: {
        linked_business: businessId,
        agent_weights:   JSON.stringify(weights),
        last_updated:    new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[signalProcessor] updateWeights error:', err.message);
  }
}

// ── 5. Create CompositeSignal record ──────────────────────────────────────────
export async function createCompositeSignal(
  businessId:    string,
  signalGroup:   SignalObject[],
  fusionType:    'temporal' | 'geographic' | 'semantic' | 'multi',
  selectedAction: CandidateAction | null,
  allCandidates:  CandidateAction[]
) {
  const compositeScore = selectedAction?.score ?? 0;

  // Merge contextual attributes from all signals in group
  const mergedContext: Record<string, any> = {};
  for (const s of signalGroup) {
    Object.assign(mergedContext, s.contextAttrs);
  }

  return prisma.compositeSignal.create({
    data: {
      business_id:       businessId,
      signal_ids:        JSON.stringify(signalGroup.map(s => s.id)),
      fusion_type:       fusionType,
      composite_score:   compositeScore,
      context:           JSON.stringify(mergedContext),
      candidate_actions: JSON.stringify(allCandidates),
      selected_action:   selectedAction ? JSON.stringify(selectedAction) : null,
      status:            'scored',
      scored_at:         new Date().toISOString(),
    },
  });
}
