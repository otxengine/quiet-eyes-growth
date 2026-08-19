import { invokeLLM } from './llm';

export interface ContentTrendPostSummary {
  competitorName: string;
  platform: string;
  engagementMultiple: number;
  topic: string | null;
  hook: string | null;
  content_pillar: string | null;
  audience_action_driver: string | null;
  text_hooks: string[];
  cta: string | null;
  visual_hooks: string[];
  style: string | null;
}

export interface ContentTrends {
  copy_insight: string | null;
  visual_insight: string | null;
}

/**
 * Synthesizes the pattern(s) recurring across the pooled top posts of MULTIPLE
 * competitors — text-only, reuses fields analyzePostCreative already extracted
 * per post (see synthesizeOutlierInsight for the single-competitor equivalent).
 * Returns two separate insights: one grounded in copy signals (text hooks, CTA,
 * audience action driver), one grounded in visual signals (visual hooks, style)
 * — so a text-vs-image trend doesn't get blurred into one merged paragraph.
 */
export async function synthesizeContentTrends(posts: ContentTrendPostSummary[]): Promise<ContentTrends> {
  if (!posts.length) return { copy_insight: null, visual_insight: null };

  try {
    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.competitorName} · ${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע]
   נושא: ${p.topic || '—'} | פילר תוכן: ${p.content_pillar || '—'} | הוק כללי: ${p.hook || '—'}
   טקסט — הוקים: ${p.text_hooks.length ? p.text_hooks.join(', ') : '—'} | CTA: ${p.cta || '—'} | קריאה לפעולה מהקהל: ${p.audience_action_driver || '—'}
   ויזואל — הוקים: ${p.visual_hooks.length ? p.visual_hooks.join(', ') : '—'} | סגנון: ${p.style || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 600,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below are top-performing posts (each got at least 2x its own account's average engagement) pooled from ${new Set(posts.map(p => p.competitorName)).size} different competitors, along with each post's individual analysis, broken into copy (text) signals and visual (image/video) signals:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "copy_insight": "2-4 sentences synthesizing the COMMON pattern(s) in the COPY/TEXT ONLY (text hooks, CTAs, what these posts ask the audience to do) that recur across MULTIPLE competitors. If there's no obvious cross-competitor copy pattern, say so honestly instead of forcing one.",
  "visual_insight": "2-4 sentences synthesizing the COMMON pattern(s) in the VISUAL/CREATIVE ONLY (visual hooks, style, imagery) that recur across MULTIPLE competitors. If there's no obvious cross-competitor visual pattern, say so honestly instead of forcing one."
}`,
    });

    return {
      copy_insight: typeof result?.copy_insight === 'string' && result.copy_insight ? result.copy_insight : null,
      visual_insight: typeof result?.visual_insight === 'string' && result.visual_insight ? result.visual_insight : null,
    };
  } catch (err: any) {
    console.warn('[synthesizeContentTrends] failed:', err.message);
    return { copy_insight: null, visual_insight: null };
  }
}
