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

/**
 * Synthesizes ONE elaborated Hebrew narrative describing the offer landscape
 * pooled across ALL of a business's tracked competitors — not just "X% have an
 * active offer" but what kinds of offers (top mechanics), when they run (peak
 * day/cadence), and through which channel (organic posts vs paid ads).
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
): Promise<string | null> {
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
      maxTokens: 600,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below is the DETERMINISTIC, pre-computed offer landscape pooled across ALL of a business's tracked competitors (these numbers are ground truth — do not invent or contradict them), plus a few real example offers:

${statsSummary}

Real examples:
${examplesSummary}

Return ONLY valid JSON. The string value MUST be in Hebrew:
{"insight": "A short elaborated paragraph (5-8 sentences) covering, as separate points grounded in the numbers above: (1) what TYPES of offers competitors run — name the top mechanics with their share, not just the single most common one; (2) WHEN offers happen — peak day and typical cadence/interval between offers; (3) WHICH CHANNEL offers run through — organic posts vs paid ads, and what that split suggests; (4) how offers are framed — value framing, urgency/scarcity use, and any conditions; (5) what share of competitors currently have an active offer running. Do not fabricate any number or detail beyond what's given. If a dimension has too little data for a real pattern (e.g. only one channel present, or too few offers for cadence), say so honestly for that point instead of forcing a conclusion — but still cover the dimensions where data exists."}`,
    });

    return typeof result?.insight === 'string' && result.insight.trim() ? result.insight.trim() : null;
  } catch (err: any) {
    console.warn('[synthesizeOffersLandscape] failed:', err.message);
    return null;
  }
}
