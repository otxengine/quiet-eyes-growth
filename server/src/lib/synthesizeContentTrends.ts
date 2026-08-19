import { invokeLLM } from './llm';

export interface ContentTrendPostSummary {
  competitorName: string;
  platform: string;
  engagementMultiple: number;
  topic: string | null;
  hook: string | null;
  content_pillar: string | null;
  audience_action_driver: string | null;
}

/**
 * Synthesizes a single explanation of the pattern(s) recurring across the
 * pooled top posts of MULTIPLE competitors — text-only, reuses fields
 * analyzePostCreative already extracted per post (see synthesizeOutlierInsight
 * for the single-competitor equivalent).
 */
export async function synthesizeContentTrends(posts: ContentTrendPostSummary[]): Promise<string | null> {
  if (!posts.length) return null;

  try {
    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.competitorName} · ${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע] נושא: ${p.topic || '—'} | הוק: ${p.hook || '—'} | פילר תוכן: ${p.content_pillar || '—'} | קריאה לפעולה: ${p.audience_action_driver || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 500,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below are top-performing posts (each got at least 2x its own account's average engagement) pooled from ${new Set(posts.map(p => p.competitorName)).size} different competitors, along with each post's individual analysis:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "insight": "2-4 sentences synthesizing the COMMON pattern(s) that recur ACROSS MULTIPLE competitors (not just within one) — recurring hooks, content pillars, or audience-engagement triggers shared by posts from different competitors. If the posts don't share an obvious cross-competitor pattern, say so honestly instead of forcing one."
}`,
    });

    return typeof result?.insight === 'string' && result.insight ? result.insight : null;
  } catch (err: any) {
    console.warn('[synthesizeContentTrends] failed:', err.message);
    return null;
  }
}
