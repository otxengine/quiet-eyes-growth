import { invokeLLM } from './llm';
import { computeContentTrendStats, normalizeContentTrendsInsight, topEntries, ContentTrendsInsight } from './contentTrendStats';

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
  insight: ContentTrendsInsight | null;
  copy_examples: CopyExample[];
}

// Picks a real verbatim text_hook/CTA off a post, in code (not LLM-transcribed) so
// the quote shown to the user is guaranteed to actually exist in the scraped data.
function representativeText(p: ContentTrendPostSummary): string | null {
  return p.text_hooks[0] || p.cta || null;
}

/**
 * Synthesizes the pattern(s) recurring across the pooled top posts of MULTIPLE
 * competitors as 6 separate topic sentences (content themes, hook patterns,
 * engagement drivers, visual style, platform performance, and one concrete
 * improvement recommendation) instead of one merged paragraph — grounded in
 * computeContentTrendStats()'s deterministic tallies plus the real per-post
 * hook/visual text, never invented. Also illustrated with up to 3 real
 * verbatim examples: the LLM only picks WHICH posts best exemplify the
 * pattern (by index), the actual quoted text is pulled straight from that
 * post's own extracted text_hooks/CTA.
 */
export async function synthesizeContentTrends(posts: ContentTrendPostSummary[]): Promise<ContentTrends> {
  if (!posts.length) return { insight: null, copy_examples: [] };

  try {
    const stats = computeContentTrendStats(posts)!;
    const statsSummary = [
      `${stats.total_posts} פוסטים מובילים נותחו, כל אחד עם ביצועים של לפחות פי 2 מהממוצע של החשבון שלו.`,
      `פילרי תוכן חוזרים, מהנפוץ לפחות נפוץ: ${topEntries(stats.content_pillar_breakdown, stats.total_posts)}.`,
      `קריאות לפעולה מהקהל, מהנפוץ לפחות נפוץ: ${topEntries(stats.audience_action_driver_breakdown, stats.total_posts)}.`,
      `פלטפורמות, מהנפוץ לפחות נפוץ: ${topEntries(stats.platform_breakdown, stats.total_posts)}.`,
    ].join('\n');

    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.competitorName} · ${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע]
   נושא: ${p.topic || '—'} | פילר תוכן: ${p.content_pillar || '—'} | הוק כללי: ${p.hook || '—'}
   טקסט — הוקים: ${p.text_hooks.length ? p.text_hooks.join(', ') : '—'} | CTA: ${p.cta || '—'} | קריאה לפעולה מהקהל: ${p.audience_action_driver || '—'}
   ויזואל — הוקים: ${p.visual_hooks.length ? p.visual_hooks.join(', ') : '—'} | סגנון: ${p.style || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 3000,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below is the DETERMINISTIC, pre-computed breakdown of top-performing posts (each got at least 2x its own account's average engagement) pooled from ${new Set(posts.map(p => p.competitorName)).size} different competitors (these tallies are ground truth — do not invent or contradict them), plus each post's individual analysis:

${statsSummary}

Individual posts:
${summary}

Return ONLY valid JSON with exactly these 6 keys, each a SHORT standalone Hebrew sentence (1-2 sentences) grounded strictly in the data above — not one merged paragraph, each key covers only its own topic:
{
  "content_themes": "recurring content pillars/themes across posts, grounded in the content-pillar tally above — name more than just the single most common one when the data supports it",
  "hook_patterns": "the common pattern(s) in text hooks/CTAs that recur across multiple competitors, grounded in the real hook/text-hook examples given",
  "engagement_drivers": "what these posts specifically asked the audience to do, grounded in the audience-action-driver tally above",
  "visual_style": "the common pattern(s) in visual/creative style (visual hooks, imagery) that recur across multiple competitors",
  "platform_performance": "which platform(s) these top-performing posts actually come from, grounded in the platform tally above, and what that suggests",
  "improvement_opportunity": "one concrete, specific, actionable recommendation for what THIS BUSINESS could adopt or adapt from what's working for competitors — not generic advice"
}
Also include: "copy_example_indices": [an array of up to 6 post numbers (the "N." at the start of each entry above) whose text hooks/CTA best exemplify hook_patterns, ordered strongest to weakest — prefer spreading picks across DIFFERENT competitors rather than several from the same one. Pick real posts, do not invent].
If a topic has too little data for a real pattern, set it to null instead of forcing a claim — but still fill in every topic where data exists. Do not fabricate any detail beyond what's given above.`,
    });

    const indices: number[] = Array.isArray(result?.copy_example_indices)
      ? result.copy_example_indices.filter((n: any) => Number.isInteger(n) && n >= 1 && n <= posts.length)
      : [];

    // Dedup by competitor — even if the LLM leans on one account's posts, the
    // examples shown should demonstrate the pattern holds across the market.
    const copyExamples: CopyExample[] = [];
    const usedCompetitors = new Set<string>();
    for (const i of indices) {
      if (copyExamples.length >= 3) break;
      const post = posts[i - 1];
      if (usedCompetitors.has(post.competitorName)) continue;
      const text = representativeText(post);
      if (!text) continue;
      copyExamples.push({ competitorName: post.competitorName, text });
      usedCompetitors.add(post.competitorName);
    }

    return {
      insight: normalizeContentTrendsInsight(result),
      copy_examples: copyExamples,
    };
  } catch (err: any) {
    console.warn('[synthesizeContentTrends] failed:', err.message);
    return { insight: null, copy_examples: [] };
  }
}
