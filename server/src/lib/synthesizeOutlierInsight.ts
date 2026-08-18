import { invokeLLM } from './llm';

export interface OutlierPostSummary {
  platform: string;
  engagementMultiple: number;
  topic: string | null;
  hook: string | null;
  content_pillar: string | null;
  audience_action_driver: string | null;
}

/**
 * Synthesizes a single explanation of the common pattern(s) across a set of
 * outlier posts, grounded in their already-computed per-post analysis (hook/
 * content_pillar/audience_action_driver) — text-only, no vision/video cost,
 * since it reuses fields analyzePostCreative already extracted.
 */
export async function synthesizeOutlierInsight(posts: OutlierPostSummary[]): Promise<string | null> {
  if (!posts.length) return null;

  try {
    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע] נושא: ${p.topic || '—'} | הוק: ${p.hook || '—'} | פילר תוכן: ${p.content_pillar || '—'} | קריאה לפעולה: ${p.audience_action_driver || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 400,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below are ${posts.length} outlier/top-performing posts (each got at least 2x this account's average engagement on its own platform), along with each post's individual analysis:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "insight": "2-4 sentences synthesizing the COMMON pattern(s) across these posts that likely drive their outperformance — recurring hooks, content pillars, or audience-engagement triggers shared by multiple posts. If the posts don't share an obvious common pattern, say so honestly instead of forcing one."
}`,
    });

    return typeof result?.insight === 'string' && result.insight ? result.insight : null;
  } catch (err: any) {
    console.warn('[synthesizeOutlierInsight] failed:', err.message);
    return null;
  }
}
