import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { computeThemeRollup } from './computeThemeRollup';

/**
 * analyzeSentiment
 * Body: { businessProfileId }
 * Returns: { overall, score, positive_count, negative_count, neutral_count,
 *            top_themes (rollup), theme_narrative (LLM gloss), key_insight, recommendations, sample_size }
 */
export async function analyzeSentiment(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const reviews = await prisma.review.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      take: 50,
      select: { text: true, sentiment: true, rating: true, created_date: true },
    });

    if (reviews.length === 0) {
      return res.json({
        overall: 'neutral', score: 50,
        positive_count: 0, negative_count: 0, neutral_count: 0,
        top_themes: [], theme_narrative: null,
        key_insight: 'אין ביקורות לניתוח עדיין',
        recommendations: [], sample_size: 0,
      });
    }

    const positiveCount = reviews.filter(r => r.sentiment === 'positive').length;
    const negativeCount = reviews.filter(r => r.sentiment === 'negative').length;
    const neutralCount  = reviews.length - positiveCount - negativeCount;
    const avgRating     = reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;

    // AC1 + AC2: rollup is the source of truth for top_themes
    const topThemes = await computeThemeRollup(businessProfileId);

    const prompt = `Analyze ${reviews.length} reviews for an Israeli business.

Reviews (up to 20):
${reviews.slice(0, 20).map((r, i) =>
  `${i + 1}. [${r.sentiment || 'neutral'}/${r.rating || '?'}⭐] "${(r.text || '').slice(0, 120)}"`
).join('\n')}

Statistics:
- Positive: ${positiveCount}, Negative: ${negativeCount}, Neutral: ${neutralCount}
- Average rating: ${avgRating.toFixed(1)}

Return ONLY valid JSON. ALL string values must be in Hebrew.
{
  "overall": "positive|negative|neutral|mixed",
  "score": 0-100,
  "key_insight": "תובנה אחת חשובה — עד 15 מילה",
  "recommendations": ["המלצה 1", "המלצה 2", "המלצה 3"]
}`;

    const result = await invokeLLM({
      prompt,
      model: 'haiku',
      response_json_schema: { type: 'object' },
    }) as any;

    await writeAutomationLog('analyzeSentiment', businessProfileId, startTime, reviews.length);

    return res.json({
      overall: result?.overall || 'neutral',
      score: result?.score || 50,
      positive_count: positiveCount,
      negative_count: negativeCount,
      neutral_count: neutralCount,
      // AC2: rollup is authoritative
      top_themes: topThemes,
      // AC3: LLM narrative is gloss only
      theme_narrative: { is_gloss: true, themes: result?.top_themes ?? null },
      key_insight: result?.key_insight || '',
      recommendations: result?.recommendations || [],
      sample_size: reviews.length,
    });
  } catch (err: any) {
    console.error('[analyzeSentiment] Error:', err.message);
    await writeAutomationLog('analyzeSentiment', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
