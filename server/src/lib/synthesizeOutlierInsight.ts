import { invokeLLM } from './llm';
import { computeContentTrendStats, normalizeContentTrendsInsight, topEntries, ContentTrendsInsight } from './contentTrendStats';

export interface OutlierPostSummary {
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

/**
 * Synthesizes this business's own outlier/top-performing posts as 6 separate
 * topic sentences (content themes, hook patterns, engagement drivers, visual
 * style, platform performance, and one concrete improvement recommendation)
 * instead of one merged paragraph — grounded in computeContentTrendStats()'s
 * deterministic tallies plus the real per-post hook/visual text, never
 * invented. Text-only, no vision/video cost, since it reuses fields
 * analyzePostCreative already extracted (see synthesizeContentTrends for the
 * pooled cross-competitor equivalent).
 */
export async function synthesizeOutlierInsight(posts: OutlierPostSummary[]): Promise<ContentTrendsInsight | null> {
  if (!posts.length) return null;

  try {
    const stats = computeContentTrendStats(posts)!;
    const statsSummary = [
      `${stats.total_posts} פוסטים מובילים של העסק נותחו, כל אחד עם ביצועים של לפחות פי 2 מהממוצע של החשבון.`,
      `פילרי תוכן חוזרים, מהנפוץ לפחות נפוץ: ${topEntries(stats.content_pillar_breakdown, stats.total_posts)}.`,
      `קריאות לפעולה מהקהל, מהנפוץ לפחות נפוץ: ${topEntries(stats.audience_action_driver_breakdown, stats.total_posts)}.`,
      `פלטפורמות, מהנפוץ לפחות נפוץ: ${topEntries(stats.platform_breakdown, stats.total_posts)}.`,
    ].join('\n');

    const summary = posts.map((p, i) =>
      `${i + 1}. [${p.platform}, ${p.engagementMultiple.toFixed(1)}x הממוצע]
   נושא: ${p.topic || '—'} | פילר תוכן: ${p.content_pillar || '—'} | הוק כללי: ${p.hook || '—'}
   טקסט — הוקים: ${p.text_hooks.length ? p.text_hooks.join(', ') : '—'} | CTA: ${p.cta || '—'} | קריאה לפעולה מהקהל: ${p.audience_action_driver || '—'}
   ויזואל — הוקים: ${p.visual_hooks.length ? p.visual_hooks.join(', ') : '—'} | סגנון: ${p.style || '—'}`,
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 3000,
      skipCache: true,
      response_json_schema: { type: 'object' },
      prompt: `You are a marketing analyst. Below is the DETERMINISTIC, pre-computed breakdown of this business's own outlier/top-performing posts (each got at least 2x this account's average engagement on its own platform) — these tallies are ground truth, do not invent or contradict them — plus each post's individual analysis:

${statsSummary}

Individual posts:
${summary}

Return ONLY valid JSON with exactly these 6 keys, each a SHORT standalone Hebrew sentence (1-2 sentences) grounded strictly in the data above — not one merged paragraph, each key covers only its own topic:
{
  "content_themes": "recurring content pillars/themes across these posts, grounded in the content-pillar tally above — name more than just the single most common one when the data supports it",
  "hook_patterns": "the common pattern(s) in text hooks/CTAs across these posts, grounded in the real hook/text-hook examples given",
  "engagement_drivers": "what these posts specifically asked the audience to do, grounded in the audience-action-driver tally above",
  "visual_style": "the common pattern(s) in visual/creative style (visual hooks, imagery) across these posts",
  "platform_performance": "which platform(s) these top-performing posts actually come from, grounded in the platform tally above, and what that suggests",
  "improvement_opportunity": "one concrete, specific, actionable recommendation for how this business could build further on what's already working for it — not generic advice"
}
If a topic has too little data for a real pattern (e.g. all posts share one platform, or too few posts for a real theme), set it to null instead of forcing a claim — but still fill in every topic where data exists. Do not fabricate any detail beyond what's given above.`,
    });

    return normalizeContentTrendsInsight(result);
  } catch (err: any) {
    console.warn('[synthesizeOutlierInsight] failed:', err.message);
    return null;
  }
}
