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

export interface CopyExample {
  competitorName: string;
  text: string;
}

export interface ContentTrends {
  copy_insight: string | null;
  visual_insight: string | null;
  copy_examples: CopyExample[];
}

// Picks a real verbatim text_hook/CTA off a post, in code (not LLM-transcribed) so
// the quote shown to the user is guaranteed to actually exist in the scraped data.
function representativeText(p: ContentTrendPostSummary): string | null {
  return p.text_hooks[0] || p.cta || null;
}

/**
 * Synthesizes the pattern(s) recurring across the pooled top posts of MULTIPLE
 * competitors — text-only, reuses fields analyzePostCreative already extracted
 * per post (see synthesizeOutlierInsight for the single-competitor equivalent).
 * Returns two separate insights: one grounded in copy signals (text hooks, CTA,
 * audience action driver), one grounded in visual signals (visual hooks, style)
 * — so a text-vs-image trend doesn't get blurred into one merged paragraph.
 * copy_insight is illustrated with up to 3 real verbatim examples: the LLM only
 * picks WHICH posts best exemplify the pattern (by index), the actual quoted
 * text is pulled straight from that post's own extracted text_hooks/CTA.
 */
export async function synthesizeContentTrends(posts: ContentTrendPostSummary[]): Promise<ContentTrends> {
  if (!posts.length) return { copy_insight: null, visual_insight: null, copy_examples: [] };

  try {
    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.competitorName} · ${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע]
   נושא: ${p.topic || '—'} | פילר תוכן: ${p.content_pillar || '—'} | הוק כללי: ${p.hook || '—'}
   טקסט — הוקים: ${p.text_hooks.length ? p.text_hooks.join(', ') : '—'} | CTA: ${p.cta || '—'} | קריאה לפעולה מהקהל: ${p.audience_action_driver || '—'}
   ויזואל — הוקים: ${p.visual_hooks.length ? p.visual_hooks.join(', ') : '—'} | סגנון: ${p.style || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 700,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below are top-performing posts (each got at least 2x its own account's average engagement) pooled from ${new Set(posts.map(p => p.competitorName)).size} different competitors, along with each post's individual analysis, broken into copy (text) signals and visual (image/video) signals:

${summary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "copy_insight": "2-4 sentences synthesizing the COMMON pattern(s) in the COPY/TEXT ONLY (text hooks, CTAs, what these posts ask the audience to do) that recur across MULTIPLE competitors. If there's no obvious cross-competitor copy pattern, say so honestly instead of forcing one.",
  "copy_example_indices": [an array of up to 3 post numbers (the "N." at the start of each entry above) whose text hooks/CTA best exemplify the copy_insight pattern you just described — pick real posts, do not invent],
  "visual_insight": "2-4 sentences synthesizing the COMMON pattern(s) in the VISUAL/CREATIVE ONLY (visual hooks, style, imagery) that recur across MULTIPLE competitors. If there's no obvious cross-competitor visual pattern, say so honestly instead of forcing one."
}`,
    });

    const indices: number[] = Array.isArray(result?.copy_example_indices)
      ? result.copy_example_indices.filter((n: any) => Number.isInteger(n) && n >= 1 && n <= posts.length)
      : [];

    const copyExamples: CopyExample[] = [];
    for (const i of indices) {
      if (copyExamples.length >= 3) break;
      const post = posts[i - 1];
      const text = representativeText(post);
      if (text) copyExamples.push({ competitorName: post.competitorName, text });
    }

    return {
      copy_insight: typeof result?.copy_insight === 'string' && result.copy_insight ? result.copy_insight : null,
      visual_insight: typeof result?.visual_insight === 'string' && result.visual_insight ? result.visual_insight : null,
      copy_examples: copyExamples,
    };
  } catch (err: any) {
    console.warn('[synthesizeContentTrends] failed:', err.message);
    return { copy_insight: null, visual_insight: null, copy_examples: [] };
  }
}
