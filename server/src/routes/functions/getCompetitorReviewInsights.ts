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
  const [competitor, themes, trend] = await Promise.all([
    prisma.competitor.findUnique({
      where: { id: competitorId },
      select: { name: true, rating: true, review_count: true },
    }),
    computeThemeRollup(businessProfileId, 90, 'google', competitorId),
    computeReviewTrend(competitorId),
  ]);

  if (!competitor) throw new Error('Competitor not found');

  const top_positive = themes.filter(t => t.positive > t.negative).slice(0, 3).map(t => t.theme);
  const top_negative = themes.filter(t => t.negative > t.positive).slice(0, 3).map(t => t.theme);

  let hebrew_summary: string | null = null;
  if (themes.length > 0) {
    const raw = await invokeLLM({
      prompt: `מתחרה: "${competitor.name}"
דירוג: ${competitor.rating ?? '?'}/5 (${competitor.review_count ?? '?'} ביקורות)
נושאים חיוביים: ${top_positive.join(', ') || 'אין'}
נושאים שליליים: ${top_negative.join(', ') || 'אין'}
${trend ? `מגמה: ${trend}` : ''}

כתוב סיכום קצר (2-3 משפטים) בעברית על חוויית לקוחות המתחרה הזה. היה ענייני ומדויק.`,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 200,
    });
    hebrew_summary = typeof raw === 'string' ? raw.trim() : null;
  }

  const payload: Record<string, any> = {
    competitor_name: competitor.name,
    rating: competitor.rating,
    review_count: competitor.review_count,
    top_positive_themes: top_positive,
    top_negative_themes: top_negative,
    hebrew_summary,
    // AC3: no reply/publish actions in payload
  };
  if (trend !== null) payload.trend = trend;  // AC2: omit when data is insufficient
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
