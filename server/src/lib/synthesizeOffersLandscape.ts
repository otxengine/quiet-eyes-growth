import { invokeLLM } from './llm';
import { OfferStats } from './offerStats';

export interface OffersLandscapeExample {
  competitorName: string;
  offer_details: string;
  date: string; // YYYY-MM-DD
}

/** OfferStats plus the landscape-only fields computed by analyzeOffersLandscape.ts
 * (not part of the reusable computeOfferStats algorithm — specific to pooling
 * "is anyone currently running an offer" across the tracked competitor set). */
export interface PooledOfferStats extends OfferStats {
  competitors_total: number;
  competitors_with_active_offer: number;
  active_offer_pct: number;
}

/**
 * Synthesizes ONE Hebrew narrative (2-4 sentences) describing the offer
 * landscape pooled across ALL of a business's tracked competitors — e.g.
 * "3 מתוך 5 מתחרים מריצים כרגע מבצע פעיל...".
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
      `${stats.total_offers} מבצעים נותחו בסך הכול. מנגנון נפוץ ביותר: ${stats.mechanic_breakdown[0]?.value || '—'} (${stats.mechanic_breakdown[0]?.count || 0}/${stats.total_offers}).`,
      stats.peak_day ? `היום הנפוץ ביותר למבצעים: יום ${stats.peak_day} (${stats.peak_day_count}/${stats.total_offers}).` : null,
      stats.avg_interval_days != null ? `מרווח ממוצע בין מבצעים: כ-${stats.avg_interval_days} ימים.` : null,
      `${stats.urgency_pct}% מהמבצעים משתמשים במסגור דחיפות/מחסור. ${stats.conditions_pct}% כוללים תנאים (מינימום קנייה/קוד/החרגות).`,
      `מסגור ערך עיקרי: ${stats.value_framing_breakdown[0]?.value || '—'}. כוונת קהל עיקרית: ${stats.audience_intent_breakdown[0]?.value || '—'}.`,
    ].filter(Boolean).join('\n');

    const examplesSummary = examples.length
      ? examples.map((e, i) => `${i + 1}. [${e.competitorName}, ${e.date}] ${e.offer_details}`).join('\n')
      : 'אין דוגמאות זמינות.';

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 400,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below is the DETERMINISTIC, pre-computed offer landscape pooled across ALL of a business's tracked competitors (these numbers are ground truth — do not invent or contradict them), plus a few real example offers:

${statsSummary}

Real examples:
${examplesSummary}

Return ONLY valid JSON. The string value MUST be in Hebrew:
{"insight": "2-4 sentences summarizing the offer landscape across competitors — cadence, mechanic, timing, and what share of competitors are currently running an active offer. Ground every claim in the numbers above, do not fabricate additional detail. If there isn't enough data for a strong pattern, say so honestly instead of forcing one."}`,
    });

    return typeof result?.insight === 'string' && result.insight.trim() ? result.insight.trim() : null;
  } catch (err: any) {
    console.warn('[synthesizeOffersLandscape] failed:', err.message);
    return null;
  }
}
