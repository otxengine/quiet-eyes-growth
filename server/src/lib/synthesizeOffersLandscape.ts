import { invokeLLM } from './llm';
import { OfferStats } from './offerStats';

export interface OffersLandscapeExample {
  competitorName: string;
  offer_details: string;
  date: string; // YYYY-MM-DD
  // Full underlying post/ad — carried so the frontend can render an
  // expandable "see the full post/ad" view, not just the short quote above.
  type: 'post' | 'ad';
  platform: string;
  media_url: string | null;
  video_url: string | null;
  caption: string | null;         // posts only
  title: string | null;           // ads only
  body: string | null;            // ads only
  cta: string | null;             // ads only
  likes: number | null;           // posts only
  comments_count: number | null;  // posts only
}

/** OfferStats plus the landscape-only fields computed by analyzeOffersLandscape.ts
 * (not part of the reusable computeOfferStats algorithm — specific to pooling
 * "is anyone currently running an offer" across the tracked competitor set). */
export interface PooledOfferStats extends OfferStats {
  competitors_total: number;
  competitors_with_active_offer: number;
  active_offer_pct: number;
}

const CHANNEL_LABELS_HE: Record<string, string> = { organic: 'פוסטים אורגניים', paid: 'מודעות ממומנות' };

type OfferBreakdownEntryLike = { value: string; count: number };

/** Renders a breakdown array as "a (x/n), b (y/n)" for the top `limit` entries — used to
 * give the LLM more than just the #1 value so it can elaborate on the real spread. */
function topEntries(breakdown: OfferBreakdownEntryLike[], total: number, limit = 3, labels?: Record<string, string>): string {
  if (!breakdown.length) return '—';
  return breakdown.slice(0, limit).map(e => `${labels?.[e.value] || e.value} (${e.count}/${total})`).join(', ');
}

// The 7 topics the offer landscape is broken into — one short grounded sentence
// each, instead of one merged paragraph. Order here is the order shown in the UI.
export const OFFERS_LANDSCAPE_TOPICS = [
  'active_offer_prevalence',
  'mechanism_breakdown',
  'distribution_channel',
  'timing_cadence',
  'value_framing',
  'urgency_scarcity',
  'conditions_restrictions',
] as const;

export type OffersLandscapeTopic = typeof OFFERS_LANDSCAPE_TOPICS[number];
export type OffersLandscapeInsight = Record<OffersLandscapeTopic, string | null>;

/**
 * Synthesizes the offer landscape pooled across ALL of a business's tracked
 * competitors as 7 separate topic sentences (active-offer prevalence, offer
 * mechanism breakdown, distribution channel, timing/cadence, value framing,
 * urgency/scarcity, conditions/restrictions) instead of one merged paragraph
 * — each topic is null when there isn't enough data for it, rather than the
 * LLM forcing a claim.
 *
 * Same "rollup is authoritative, LLM narrative is gloss only" discipline used
 * elsewhere in this codebase (see computeThemeRollup / getCompetitorReviewInsights):
 * the deterministic `stats` (from computeOfferStats + the landscape-only fields)
 * and the real `examples` are the only ground truth — the LLM is told explicitly
 * not to invent numbers or details beyond what's supplied.
 */
export async function synthesizeOffersLandscape(
  stats: PooledOfferStats | null,
  examples: OffersLandscapeExample[],
): Promise<OffersLandscapeInsight | null> {
  if (!stats || !stats.total_offers) return null;

  try {
    const statsSummary = [
      `${stats.competitors_with_active_offer}/${stats.competitors_total} מתחרים מריצים כרגע מבצע פעיל (${stats.active_offer_pct}%).`,
      `${stats.total_offers} מבצעים נותחו בסך הכול.`,
      `סוגי מבצעים (מנגנון), מהנפוץ לפחות נפוץ: ${topEntries(stats.mechanic_breakdown, stats.total_offers)}.`,
      `ערוץ הפצת המבצעים: ${topEntries(stats.channel_breakdown, stats.total_offers, 2, CHANNEL_LABELS_HE)}.`,
      stats.peak_day ? `היום הנפוץ ביותר למבצעים: יום ${stats.peak_day} (${stats.peak_day_count}/${stats.total_offers}).` : null,
      stats.avg_interval_days != null ? `מרווח ממוצע בין מבצעים: כ-${stats.avg_interval_days} ימים.` : null,
      `${stats.urgency_pct}% מהמבצעים משתמשים במסגור דחיפות/מחסור. ${stats.conditions_pct}% כוללים תנאים (מינימום קנייה/קוד/החרגות).`,
      `מסגור ערך, מהנפוץ לפחות נפוץ: ${topEntries(stats.value_framing_breakdown, stats.total_offers, 2)}.`,
      `כוונת קהל, מהנפוץ לפחות נפוץ: ${topEntries(stats.audience_intent_breakdown, stats.total_offers, 2)}.`,
    ].filter(Boolean).join('\n');

    const examplesSummary = examples.length
      ? examples.map((e, i) => `${i + 1}. [${e.competitorName}, ${e.date}] ${e.offer_details}`).join('\n')
      : 'אין דוגמאות זמינות.';

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 700,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below is the DETERMINISTIC, pre-computed offer landscape pooled across ALL of a business's tracked competitors (these numbers are ground truth — do not invent or contradict them), plus a few real example offers:

${statsSummary}

Real examples:
${examplesSummary}

Return ONLY valid JSON with exactly these 7 keys, each a SHORT standalone Hebrew sentence (1-2 sentences) grounded strictly in the numbers above — not one merged paragraph, each key covers only its own topic:
{
  "active_offer_prevalence": "what share of competitors currently have an active offer running",
  "mechanism_breakdown": "the top offer mechanics/types with their share — name more than just the single most common one when the data supports it",
  "distribution_channel": "organic posts vs paid ads split, and what that suggests",
  "timing_cadence": "peak day and typical interval/cadence between offers",
  "value_framing": "relative vs absolute value framing split",
  "urgency_scarcity": "share of offers using urgency/scarcity framing",
  "conditions_restrictions": "share of offers with restrictive conditions (minimum purchase, code, exclusions)"
}
If a specific topic has too little data for a real pattern (e.g. no dated offers for cadence, or only one channel present), set that key to null instead of forcing a claim — but still fill in every topic where data exists. Do not fabricate any number or detail beyond what's given above.`,
    });

    if (!result || typeof result !== 'object') return null;
    const insight = {} as OffersLandscapeInsight;
    for (const topic of OFFERS_LANDSCAPE_TOPICS) {
      const v = result[topic];
      insight[topic] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
    return Object.values(insight).some(v => v) ? insight : null;
  } catch (err: any) {
    console.warn('[synthesizeOffersLandscape] failed:', err.message);
    return null;
  }
}
