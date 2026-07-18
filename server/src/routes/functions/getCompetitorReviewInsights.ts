import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { computeThemeRollup } from './computeThemeRollup';

const GOOGLE_SOURCES = ['google_business_api', 'google_places', 'serp_google_maps_reviews'];

async function computeReviewTrend(competitorId: string): Promise<string | null> {
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(now); d60.setDate(d60.getDate() - 60);

  const reviews = await prisma.review.findMany({
    where: { linked_competitor: competitorId, source_origin: { in: GOOGLE_SOURCES }, rating: { not: null } },
    select: { rating: true, created_date: true },
    take: 200,
  });

  const recent = reviews.filter(r => new Date(r.created_date) >= d30);
  const prior  = reviews.filter(r => new Date(r.created_date) >= d60 && new Date(r.created_date) < d30);

  // ponytail: omit rather than fabricate — AC2 explicitly requires this guard
  if (recent.length < 3 || prior.length < 3) return null;

  const avg = (arr: typeof reviews) => arr.reduce((s, r) => s + (r.rating ?? 0), 0) / arr.length;
  const delta = avg(recent) - avg(prior);
  if (delta > 0.1) return 'improving';
  if (delta < -0.1) return 'declining';
  return 'stable';
}

export async function getCompetitorReviewInsightsData(businessProfileId: string, competitorId: string) {
  const reviewSelect = { reviewer_name: true, rating: true, text: true, created_date: true } as const;

  const [competitor, themes, trend, ownReviews, latestReviews] = await Promise.all([
    prisma.competitor.findUnique({
      where: { id: competitorId },
      select: { name: true, rating: true, review_count: true },
    }),
    computeThemeRollup(businessProfileId, 90, 'google', competitorId),
    computeReviewTrend(competitorId),
    prisma.review.findMany({
      where: { linked_business: businessProfileId, source_origin: { in: GOOGLE_SOURCES }, rating: { not: null } },
      select: { rating: true },
      take: 500,
    }),
    prisma.review.findMany({
      where: { linked_competitor: competitorId, source_origin: { in: GOOGLE_SOURCES } },
      orderBy: { created_date: 'desc' },
      select: reviewSelect,
      take: 3,
    }),
  ]);

  if (!competitor) throw new Error('Competitor not found');

  const ownRatings = (ownReviews as any[]).map((r: any) => r.rating).filter(Boolean);
  const ownAvg = ownRatings.length > 0
    ? ownRatings.reduce((s: number, r: number) => s + r, 0) / ownRatings.length
    : null;
  const ratingDelta = ownAvg != null && competitor.rating != null
    ? +((competitor.rating as number) - ownAvg).toFixed(1)
    : null;

  const top_positive = themes.filter(t => t.positive > t.negative).slice(0, 3).map(t => t.theme);
  const top_negative = themes.filter(t => t.negative > t.positive).slice(0, 3).map(t => t.theme);

  let hebrew_summary: string | null = null;
  if (themes.length > 0) {
    const ownLine = ownAvg != null ? `העסק שלך: ${ownAvg.toFixed(1)}/5` : '';
    const deltaLine = ratingDelta != null
      ? `פער: ${ratingDelta > 0 ? '+' : ''}${ratingDelta} (המתחרה ${ratingDelta > 0 ? 'מעל' : 'מתחת ל'}עסקך)`
      : '';
    const raw = await invokeLLM({
      prompt: `${ownLine}
מתחרה: "${competitor.name}" — ${competitor.rating ?? '?'}/5 (${competitor.review_count ?? '?'} ביקורות)
${deltaLine}
נושאים חיוביים: ${top_positive.join(', ') || 'אין'}
נושאים שליליים: ${top_negative.join(', ') || 'אין'}
${trend ? `מגמה: ${trend}` : ''}

כתוב סיכום השוואתי קצר (2-3 משפטים) בעברית — השווה את המתחרה לעסקך. ציין אם הדירוג טוב או רע ביחס אליך.`,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 200,
    });
    hebrew_summary = typeof raw === 'string' ? raw.trim() : null;
  }

  const toReviewSnippet = (r: any) => ({
    reviewer_name: r.reviewer_name || null,
    rating: r.rating,
    text: r.text || '',
    created_date: r.created_date,
  });

  // Latest 3 reviews per topic (topics field is comma-separated)
  const allTopics = [...top_positive, ...top_negative];
  const topicReviewsArr = await Promise.all(
    allTopics.map(topic =>
      prisma.review.findMany({
        where: { linked_competitor: competitorId, source_origin: { in: GOOGLE_SOURCES }, topics: { contains: topic } },
        orderBy: { created_date: 'desc' },
        select: reviewSelect,
        take: 3,
      })
    )
  );
  const topic_reviews = Object.fromEntries(
    allTopics.map((topic, i) => [topic, (topicReviewsArr[i] as any[]).map(toReviewSnippet)])
  );

  const payload: Record<string, any> = {
    competitor_name: competitor.name,
    rating: competitor.rating,
    review_count: competitor.review_count,
    own_rating: ownAvg != null ? +ownAvg.toFixed(1) : null,
    rating_delta: ratingDelta,
    top_positive_themes: top_positive,
    top_negative_themes: top_negative,
    topic_reviews,
    hebrew_summary,
    latest_reviews: (latestReviews as any[]).map(toReviewSnippet),
  };
  if (trend !== null) payload.trend = trend;
  return payload;
}

export async function getCompetitorReviewInsights(req: Request, res: Response) {
  const { competitorId, businessProfileId } = req.body;
  if (!competitorId || !businessProfileId) {
    return res.status(400).json({ error: 'Missing competitorId or businessProfileId' });
  }
  try {
    const data = await getCompetitorReviewInsightsData(businessProfileId, competitorId);
    return res.json(data);
  } catch (err: any) {
    console.error('[getCompetitorReviewInsights]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
