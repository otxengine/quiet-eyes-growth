import { invokeLLM } from './llm';
import { ThemeCount } from '../routes/functions/computeThemeRollup';

export interface ReviewExample {
  theme: string;
  polarity: 'positive' | 'negative';
  text: string;
}

export interface ReviewThemeInsightContext {
  scope: 'own' | 'competitor_pooled';
  ownAvgRating?: number;
  competitorCount?: number;
  examples?: ReviewExample[];
}

/**
 * Synthesizes one Hebrew narrative grounded ONLY in the supplied theme counts and
 * verbatim examples. Generalizes the inline LLM-narrative call in
 * getCompetitorReviewInsights.ts (~lines 68-87) so the "rollup is authoritative,
 * LLM is gloss only" discipline is shared by the own- and pooled-competitor
 * Reviews-pillar functions instead of being duplicated. The LLM must not invent
 * themes, numbers, or competitors that are not present in the input.
 */
export async function synthesizeReviewThemeInsight(
  themes: ThemeCount[],
  context: ReviewThemeInsightContext,
): Promise<string | null> {
  if (!themes.length) return null;

  const topPositive = themes.filter(t => t.positive > t.negative).slice(0, 5);
  const topNegative = themes.filter(t => t.negative > t.positive).slice(0, 5);
  if (!topPositive.length && !topNegative.length) return null;

  const fmt = (t: ThemeCount) => `${t.theme} (חיובי: ${t.positive}, שלילי: ${t.negative}, סה"כ: ${t.total})`;
  const positiveLine = topPositive.length ? topPositive.map(fmt).join(', ') : 'אין';
  const negativeLine = topNegative.length ? topNegative.map(fmt).join(', ') : 'אין';

  const examples = context.examples ?? [];
  const examplesBlock = examples.length
    ? examples.map(e => `- [${e.theme} / ${e.polarity === 'positive' ? 'חיובי' : 'שלילי'}] "${e.text}"`).join('\n')
    : 'אין';

  const scopeLine = context.scope === 'own'
    ? (context.ownAvgRating != null ? `דירוג ממוצע של העסק: ${context.ownAvgRating.toFixed(1)}/5` : '')
    : `מבוסס על ${context.competitorCount ?? 'כמה'} מתחרים במעקב, מאוחד לכדי תמונה אחת`;

  const lengthInstruction = context.scope === 'own'
    ? '3-5 משפטים בעברית, המכסים גם נקודות כאב וגם דברים שהלקוחות אוהבים'
    : '2-4 משפטים בעברית, מנוסחים כתובנה על פני כלל המתחרים במעקב (למשל "אצל המתחרים שלך...")';

  try {
    const raw = await invokeLLM({
      prompt: `${scopeLine}
נושאים חיוביים (מבוסס על ניתוח אמיתי של ביקורות): ${positiveLine}
נושאים שליליים (מבוסס על ניתוח אמיתי של ביקורות): ${negativeLine}
ציטוטים אמיתיים מהביקורות:
${examplesBlock}

כתוב תובנה קצרה (${lengthInstruction}), מבוססת אך ורק על הנתונים והציטוטים שסופקו למעלה. אל תמציא נושאים, מספרים או פרטים שלא הופיעו כאן.`,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch (err: any) {
    console.warn('[synthesizeReviewThemeInsight] failed:', err.message);
    return null;
  }
}
