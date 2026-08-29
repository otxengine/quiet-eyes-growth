import { Request, Response } from 'express';
import { prisma } from '../../db';
import { computeThemeRollup, ThemeCount } from './computeThemeRollup';
import { GOOGLE_REVIEW_SOURCES } from '../../lib/signalGuard';
import { synthesizeReviewThemeInsight, ReviewExample } from '../../lib/synthesizeReviewThemeInsight';

// 48h — matches the freshness window used by analyzeSocialPosts.ts / content_trends_* fields.
const COMPETITOR_REVIEWS_INTERVAL_MS = 48 * 60 * 60 * 1000;
const TOP_THEME_LIMIT = 3;
const SNIPPETS_PER_THEME = 2;

export interface PooledThemeCount extends ThemeCount {
  competitors_mentioning: number;
}

/**
 * Calls computeThemeRollup once per tracked competitor (unchanged, reused as-is) and
 * merges the per-competitor per-theme counts into pooled totals, tracking how many
 * distinct competitors actually had that theme mentioned (competitors_mentioning).
 */
async function computePooledThemes(
  businessProfileId: string,
  competitorIds: string[],
): Promise<PooledThemeCount[]> {
  const perCompetitor = await Promise.all(
    competitorIds.map(id => computeThemeRollup(businessProfileId, 90, 'google', id)),
  );

  const merged: Record<string, PooledThemeCount> = {};
  for (const themes of perCompetitor) {
    for (const t of themes) {
      if (!merged[t.theme]) {
        merged[t.theme] = { theme: t.theme, positive: 0, negative: 0, neutral: 0, total: 0, competitors_mentioning: 0 };
      }
      merged[t.theme].positive += t.positive;
      merged[t.theme].negative += t.negative;
      merged[t.theme].neutral += t.neutral;
      merged[t.theme].total += t.total;
      if (t.total > 0) merged[t.theme].competitors_mentioning += 1;
    }
  }

  return Object.values(merged).sort((a, b) => b.total - a.total);
}

/**
 * Picks up to `limitTotal` representative verbatim snippets for one theme/polarity,
 * spread across different competitors (adapts the per-topic snippet query in
 * getCompetitorReviewInsights.ts ~lines 89-109 to a small per-competitor sample
 * instead of one competitor's full history).
 */
async function fetchPooledTopicSnippets(
  competitorIds: string[],
  topic: string,
  polarity: 'positive' | 'negative',
  limitTotal = SNIPPETS_PER_THEME,
): Promise<ReviewExample[]> {
  const results: ReviewExample[] = [];
  for (const competitorId of competitorIds) {
    if (results.length >= limitTotal) break;
    const rows = await prisma.review.findMany({
      where: { linked_competitor: competitorId, source_origin: { in: GOOGLE_REVIEW_SOURCES }, topics: { contains: topic } },
      orderBy: { created_date: 'desc' },
      select: { text: true, topic_sentiment: true },
      take: 10,
    });
    const match = (rows as any[]).find(r => {
      try { return JSON.parse(r.topic_sentiment || '{}')[topic] === polarity; } catch { return false; }
    });
    if (match) results.push({ theme: topic, polarity, text: match.text || '' });
  }
  return results;
}

/**
 * analyzeCompetitorReviewInsightsPooled — Reviews pillar (Insights page), pooled across
 * ALL tracked competitors (differentiator from the existing per-competitor
 * getCompetitorReviewInsights used in ReviewsCompare.jsx). computeThemeRollup is called
 * once per competitor with platformFilter='google' (unchanged, reused as-is) — matching
 * the single-competitor equivalent in getCompetitorReviewInsights.ts, since competitor
 * review data is sourced via Google Maps scraping (collectCompetitorReviews.ts); using
 * 'google' keeps the pooled rollup consistent with that established convention rather
 * than mixing in any non-Google-sourced rows. 48h cache on
 * BusinessProfile.competitor_reviews_pillar_insight_at, bypassed with { force: true }.
 *
 * Body: { businessProfileId, force? }
 */
export async function analyzeCompetitorReviewInsightsPooled(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
      select: {
        competitor_reviews_pillar_insight: true,
        competitor_reviews_pillar_stats: true,
        competitor_reviews_pillar_insight_at: true,
      },
    });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    if (!force && profile.competitor_reviews_pillar_insight && profile.competitor_reviews_pillar_insight_at) {
      const age = Date.now() - new Date(profile.competitor_reviews_pillar_insight_at).getTime();
      if (age < COMPETITOR_REVIEWS_INTERVAL_MS) {
        return res.json({
          insight: profile.competitor_reviews_pillar_insight,
          stats: profile.competitor_reviews_pillar_stats ? JSON.parse(profile.competitor_reviews_pillar_stats) : [],
          cached: true,
        });
      }
    }

    // Tracked-competitor filter matches collectCompetitorReviews.ts / scheduledAnalyzeSocialPosts
    // (the review-ingest and per-competitor-analysis functions this one pools on top of).
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId, tracking_status: 'approved', not_relevant: false },
      select: { id: true, name: true },
    });
    if (!competitors.length) {
      // ponytail: nothing tracked yet — omit rather than fabricate, don't throw.
      return res.json({ insight: null, stats: [], cached: false });
    }

    const competitorIds = competitors.map(c => c.id);
    const pooledThemes = await computePooledThemes(businessProfileId, competitorIds);
    if (!pooledThemes.length) {
      return res.json({ insight: null, stats: [], cached: false });
    }

    const topPositive = pooledThemes.filter(t => t.positive > t.negative).slice(0, TOP_THEME_LIMIT);
    const topNegative = pooledThemes.filter(t => t.negative > t.positive).slice(0, TOP_THEME_LIMIT);

    const exampleGroups = await Promise.all([
      ...topPositive.map(t => fetchPooledTopicSnippets(competitorIds, t.theme, 'positive')),
      ...topNegative.map(t => fetchPooledTopicSnippets(competitorIds, t.theme, 'negative')),
    ]);
    const examples = exampleGroups.flat();

    const insight = await synthesizeReviewThemeInsight(pooledThemes, {
      scope: 'competitor_pooled',
      competitorCount: competitors.length,
      examples,
    });

    if (insight) {
      await prisma.businessProfile.update({
        where: { id: businessProfileId },
        data: {
          competitor_reviews_pillar_insight: insight,
          competitor_reviews_pillar_stats: JSON.stringify(pooledThemes),
          competitor_reviews_pillar_insight_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }

    return res.json({ insight, stats: pooledThemes, cached: false });
  } catch (err: any) {
    console.error('[analyzeCompetitorReviewInsightsPooled]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
