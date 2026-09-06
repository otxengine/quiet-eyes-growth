import { Request, Response } from 'express';
import { prisma } from '../../db';
import { computeThemeRollup, ThemeCount, REVIEWS_INSIGHTS_WINDOW_DAYS } from './computeThemeRollup';
import { synthesizeReviewThemeInsight, ReviewExample } from '../../lib/synthesizeReviewThemeInsight';

// 48h — matches the freshness window used by analyzeSocialPosts.ts / content_trends_* fields.
const OWN_REVIEWS_INTERVAL_MS = 48 * 60 * 60 * 1000;
const TOP_THEME_LIMIT = 3;
const SNIPPETS_PER_THEME = 2;

async function fetchTopicSnippets(
  businessProfileId: string,
  topic: string,
  polarity: 'positive' | 'negative',
  limit = SNIPPETS_PER_THEME,
): Promise<ReviewExample[]> {
  const rows = await prisma.review.findMany({
    where: { linked_business: businessProfileId, topics: { contains: topic } },
    orderBy: { created_date: 'desc' },
    select: { text: true, topic_sentiment: true },
    take: 20,
  });
  return (rows as any[])
    .filter(r => {
      try { return JSON.parse(r.topic_sentiment || '{}')[topic] === polarity; } catch { return false; }
    })
    .slice(0, limit)
    .map(r => ({ theme: topic, polarity, text: r.text || '' }));
}

/**
 * analyzeOwnReviewInsights — Reviews pillar (Insights page), own-business scope.
 * Rolls up this business's own review topic_sentiment (via computeThemeRollup, unchanged),
 * pulls real verbatim snippets per top theme, and synthesizes one Hebrew narrative
 * covering both pain points and what customers love. 48h cache on
 * BusinessProfile.own_reviews_pillar_insight_at, bypassed with { force: true }.
 *
 * Body: { businessProfileId, force? }
 */
export async function analyzeOwnReviewInsights(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: {
        own_reviews_pillar_insight: true,
        own_reviews_pillar_examples: true,
        own_reviews_pillar_stats: true,
        own_reviews_pillar_insight_at: true,
      },
    });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    if (!force && profile.own_reviews_pillar_insight && profile.own_reviews_pillar_insight_at) {
      const age = Date.now() - new Date(profile.own_reviews_pillar_insight_at).getTime();
      if (age < OWN_REVIEWS_INTERVAL_MS) {
        return res.json({
          insight: profile.own_reviews_pillar_insight,
          examples: profile.own_reviews_pillar_examples ? JSON.parse(profile.own_reviews_pillar_examples) : [],
          stats: profile.own_reviews_pillar_stats ? JSON.parse(profile.own_reviews_pillar_stats) : [],
          cached: true,
        });
      }
    }

    const themes: ThemeCount[] = await computeThemeRollup(businessProfileId, REVIEWS_INSIGHTS_WINDOW_DAYS);
    if (!themes.length) {
      // ponytail: no reviews yet — omit rather than fabricate, don't throw.
      return res.json({ insight: null, examples: [], stats: [], cached: false });
    }

    const topPositive = themes.filter(t => t.positive > t.negative).slice(0, TOP_THEME_LIMIT);
    const topNegative = themes.filter(t => t.negative > t.positive).slice(0, TOP_THEME_LIMIT);

    const exampleGroups = await Promise.all([
      ...topPositive.map(t => fetchTopicSnippets(businessProfileId, t.theme, 'positive')),
      ...topNegative.map(t => fetchTopicSnippets(businessProfileId, t.theme, 'negative')),
    ]);
    const examples = exampleGroups.flat();

    const insight = await synthesizeReviewThemeInsight(themes, { scope: 'own', examples });

    if (insight) {
      await prisma.businessProfile.update({
        where: { id: businessProfileId },
        data: {
          own_reviews_pillar_insight: insight,
          own_reviews_pillar_examples: examples.length ? JSON.stringify(examples) : null,
          own_reviews_pillar_stats: JSON.stringify(themes),
          own_reviews_pillar_insight_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }

    return res.json({ insight, examples, stats: themes, cached: false });
  } catch (err: any) {
    console.error('[analyzeOwnReviewInsights]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
