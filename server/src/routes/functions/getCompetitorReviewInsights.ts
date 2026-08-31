import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { computeThemeRollup, computeReviewTrend } from './computeThemeRollup';
import { GOOGLE_REVIEW_SOURCES as GOOGLE_SOURCES } from '../../lib/signalGuard';

export async function getCompetitorReviewInsightsData(businessProfileId: string, competitorId: string) {
  const reviewSelect = { reviewer_name: true, rating: true, text: true, created_at: true, created_date: true, topic_sentiment: true } as const;

  const [competitor, themes, trend, ownReviews, latestReviews] = await Promise.all([
    prisma.competitor.findUnique({
      where: { id: competitorId },
      select: { name: true, rating: true, review_count: true },
    }),
    computeThemeRollup(businessProfileId, 90, 'google', competitorId),
    computeReviewTrend({ linked_competitor: competitorId }),
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

  const toSnippet = (r: any) => ({
    reviewer_name: r.reviewer_name || null,
    rating: r.rating,
    text: r.text || '',
    created_at: r.created_at,
    created_date: r.created_date,
    // topic_sentiment not forwarded to FE
  });

  // Latest 3 reviews per topic, filtered by the actual per-review topic sentiment
  const fetchTopicReviews = async (topic: string, polarity: 'positive' | 'negative') => {
    const rows = await prisma.review.findMany({
      where: { linked_competitor: competitorId, source_origin: { in: GOOGLE_SOURCES }, topics: { contains: topic } },
      orderBy: { created_date: 'desc' },
      select: reviewSelect,
      take: 20,
    });
    return rows.filter(r => {
      try { return JSON.parse((r as any).topic_sentiment || '{}')[topic] === polarity; } catch { return false; }
    }).slice(0, 3);
  };

  const allTopics = [...top_positive, ...top_negative];
  const topicReviewsArr = await Promise.all([
    ...top_positive.map(t => fetchTopicReviews(t, 'positive')),
    ...top_negative.map(t => fetchTopicReviews(t, 'negative')),
  ]);

  // Build all snippets first, then batch-translate non-Hebrew texts in one call
  const topicSnippets = allTopics.map((_, i) => (topicReviewsArr[i] as any[]).map(toSnippet));
  const latestSnippets = (latestReviews as any[]).map(toSnippet);

  const isHebrew = (t: string) => /[֐-׿]/.test(t);
  const uniqueTexts = [...new Set(
    [...topicSnippets.flat(), ...latestSnippets].map(s => s.text).filter(t => t && !isHebrew(t))
  )];

  const translationMap: Record<string, string> = {};
  if (uniqueTexts.length > 0) {
    const raw = await invokeLLM({
      prompt: `תרגם את הביקורות הבאות לעברית. החזר אך ורק שורות ממוספרות בפורמט "N. [תרגום]", ללא הסברים:\n\n${uniqueTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
      model: 'haiku',
      maxTokens: 3000,
      skipCache: false,
    });
    (typeof raw === 'string' ? raw : '').split('\n').forEach(line => {
      const m = line.match(/^(\d+)\.\s*(.+)/);
      if (m) translationMap[uniqueTexts[+m[1] - 1]] = m[2].trim();
    });
  }

  const translate = (s: any) => ({ ...s, text: translationMap[s.text] ?? s.text });

  const topic_reviews = Object.fromEntries(
    allTopics.map((topic, i) => [topic, topicSnippets[i].map(translate)])
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
    latest_reviews: latestSnippets.map(translate),
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
