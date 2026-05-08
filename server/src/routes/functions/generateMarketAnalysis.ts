import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * generateMarketAnalysis
 * Produces 4 market metrics + LLM-based strategic analysis.
 *
 * Body: { businessProfileId }
 * Returns: { analysis, metrics }
 */
export async function generateMarketAnalysis(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [signals, leads, competitors, reviews] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 50,
        select: { summary: true, category: true, impact_level: true, detected_at: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 100,
        select: { status: true, source: true, score: true, created_date: true, service_needed: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        select: { name: true, rating: true, trend_direction: true, strengths: true, services: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        take: 30,
        select: { rating: true, sentiment: true, created_date: true },
      }),
    ]);

    const opportunities  = signals.filter(s => s.category === 'opportunity').length;
    const threats        = signals.filter(s => s.category === 'threat').length;
    const hotLeads       = leads.filter(l => l.status === 'hot').length;
    const completedLeads = leads.filter(l => l.status === 'completed').length;
    const monthLeads     = leads.filter(l => (l.created_date || '') >= monthAgo).length;
    const conversionRate = leads.length > 0 ? Math.round((completedLeads / leads.length) * 100) : 0;

    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + (r.rating || 4), 0) / reviews.length).toFixed(1)
      : null;

    const positiveReviews = reviews.filter(r => r.sentiment === 'positive' || (r.rating || 0) >= 4).length;
    const reviewSatisfaction = reviews.length > 0 ? Math.round((positiveReviews / reviews.length) * 100) : null;

    const trendingOpps = signals
      .filter(s => s.category === 'opportunity' || s.category === 'trend')
      .slice(0, 5)
      .map(s => s.summary.slice(0, 80));

    const competitorNames = competitors.map(c => `${c.name} (${c.rating || '?'}⭐, מגמה: ${c.trend_direction || '?'})`);

    const metrics = {
      opportunities,
      threats,
      hot_leads:        hotLeads,
      conversion_rate:  conversionRate,
      month_leads:      monthLeads,
      avg_rating:       avgRating,
      review_satisfaction: reviewSatisfaction,
      total_competitors: competitors.length,
      total_signals:    signals.length,
    };

    const topServices = leads
      .filter(l => l.service_needed)
      .reduce((acc: Record<string, number>, l) => { acc[l.service_needed!] = (acc[l.service_needed!] || 0) + 1; return acc; }, {});
    const topServicesList = Object.entries(topServices).sort(([,a],[,b]) => b-a).slice(0, 3).map(([s]) => s);

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 600,
      prompt: `אתה אנליסט שוק בכיר לעסקים קטנים ישראלים. ניתוח זה יוצג לבעל העסק — כתוב תובנות ספציפיות ומדויקות, לא גנריות.

עסק: "${profile.name}" | תחום: ${profile.category} | עיר: ${profile.city}
שירותים: ${profile.relevant_services || 'לא צוינו'}
שוק יעד: ${profile.target_market || 'לא צוין'}
${profile.description ? `תיאור: ${profile.description}` : ''}

=== נתונים כמותיים ===
• סיגנלים שוק: ${signals.length} (${opportunities} הזדמנויות, ${threats} איומים)
• לידים: ${leads.length} סה"כ | ${hotLeads} חמים | המרה: ${conversionRate}%
${topServicesList.length > 0 ? `• שירותים מבוקשים: ${topServicesList.join(', ')}` : ''}
• ביקורות: ${reviews.length}${avgRating ? ` | ממוצע ${avgRating}⭐ | שביעות רצון: ${reviewSatisfaction}%` : ''}
• מתחרים: ${competitorNames.slice(0, 5).join(', ')}

הזדמנויות מזוהות:
${trendingOpps.length > 0 ? trendingOpps.map(o => `• ${o}`).join('\n') : '• אין מספיק נתונים עדיין'}

JSON בלבד:
{
  "market_size_estimate": "גדול|בינוני|קטן",
  "market_trend": "growing|stable|declining",
  "our_position": "leader|challenger|niche|new",
  "top_opportunity": "הזדמנות מספר 1 — ספציפית עם שם שירות / פלטפורמה / קהל יעד",
  "biggest_threat": "האיום הגדול ביותר — ספציפי ומדויק",
  "recommended_focus": "על מה להתמקד ב-30 ימים הקרובים — עם ערוץ ספציפי",
  "market_gaps": ["פער 1 — ספציפי לסקטור ולעיר", "פער 2 — הזדמנות שטרם מנוצלת"],
  "competitive_advantage": "היתרון המשמעותי ביותר שלנו מול המתחרים — ממוקד"
}`,
      response_json_schema: { type: 'object' },
    });

    return res.json({ analysis: result, metrics });
  } catch (err: any) {
    console.error('[generateMarketAnalysis] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
