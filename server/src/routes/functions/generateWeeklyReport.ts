import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

// Same-day cache to avoid burning LLM credits on rapid re-triggers
const _weeklyCache = new Map<string, { result: any; date: string }>();

/**
 * generateWeeklyReport
 * Generates a structured weekly performance report.
 *
 * Body: { businessProfileId }
 * Returns: { report, stats }
 */
export async function generateWeeklyReport(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const todayDate = new Date().toISOString().slice(0, 10);
  const cacheKey = `${businessProfileId}:${todayDate}`;

  // Return cached result for same-day re-triggers unless force=true
  const cached = _weeklyCache.get(cacheKey);
  if (cached && !force) {
    return res.json({ ...cached.result, cached: true });
  }

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [allSignals, allLeads, allReviews, competitors] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 100,
        select: { summary: true, category: true, impact_level: true, detected_at: true, recommended_action: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 100,
        select: { status: true, source: true, score: true, created_date: true, service_needed: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 50,
        select: { sentiment: true, rating: true, created_date: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 5,
        select: { name: true, rating: true, trend_direction: true },
      }),
    ]);

    // This week stats
    const weekSignals = allSignals.filter(s => (s.detected_at || '') >= weekAgo);
    const weekLeads   = allLeads.filter(l => (l.created_date || '') >= weekAgo);
    const weekReviews = allReviews.filter(r => (r.created_date || '') >= weekAgo);

    const hotLeads       = allLeads.filter(l => l.status === 'hot').length;
    const completedLeads = allLeads.filter(l => l.status === 'completed').length;
    const opportunities  = weekSignals.filter(s => s.category === 'opportunity').length;
    const threats        = weekSignals.filter(s => s.category === 'threat').length;

    const avgRating = weekReviews.length > 0
      ? (weekReviews.reduce((s, r) => s + (r.rating || 4), 0) / weekReviews.length).toFixed(1)
      : null;

    // Source breakdown for leads
    const leadSources: Record<string, number> = {};
    allLeads.filter(l => (l.created_date || '') >= monthAgo).forEach(l => {
      const src = l.source || 'unknown';
      leadSources[src] = (leadSources[src] || 0) + 1;
    });

    // Conversion rate
    const conversionRate = allLeads.length > 0
      ? Math.round((completedLeads / allLeads.length) * 100)
      : 0;

    // Competitor changes this week
    const competitorSignals = weekSignals.filter(s => s.category === 'competitor_move');

    const stats = {
      week_signals:        weekSignals.length,
      week_leads:          weekLeads.length,
      week_reviews:        weekReviews.length,
      hot_leads:           hotLeads,
      completed_leads:     completedLeads,
      opportunities:       opportunities,
      threats:             threats,
      avg_rating:          avgRating,
      conversion_rate:     conversionRate,
      competitor_changes:  competitorSignals.length,
      lead_sources:        leadSources,
      total_leads:         allLeads.length,
      total_signals:       allSignals.length,
    };

    const topSignals = weekSignals
      .filter(s => s.impact_level === 'high')
      .slice(0, 3)
      .map(s => `• [${s.category}] ${s.summary.slice(0, 80)}`);

    const topLeadServices = allLeads
      .filter(l => (l.created_date || '') >= weekAgo && l.service_needed)
      .map(l => l.service_needed)
      .reduce((acc: Record<string, number>, s) => { acc[s!] = (acc[s!] || 0) + 1; return acc; }, {});
    const topService = Object.entries(topLeadServices).sort(([,a],[,b]) => (b as number)-(a as number))[0]?.[0] || '';

    const competitorNames = competitors.map(c => `${c.name}(${c.rating ?? '?'}⭐)`).join(', ');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 800,
      prompt: `You are a senior business advisor for small Israeli businesses. Write an executive weekly report — direct, focused, with one sharp insight that drives action.
Return ONLY valid JSON. ALL string values must be in Hebrew.

Business: "${profile.name}" | Sector: ${profile.category} | City: ${profile.city}
${profile.description ? `Description: ${profile.description}` : ''}

=== נתוני השבוע ===
• תובנות שוק: ${weekSignals.length} חדשות (${opportunities} הזדמנויות, ${threats} איומים)
• לידים: ${weekLeads.length} חדשים | ${hotLeads} חמים כרגע | המרה כוללת: ${conversionRate}%
• ביקורות: ${weekReviews.length} חדשות${avgRating ? ` | ממוצע: ${avgRating}⭐` : ''}
• שינויים אצל מתחרים: ${competitorSignals.length}
${competitorNames ? `• מתחרים: ${competitorNames}` : ''}
${topService ? `• שירות מבוקש השבוע: ${topService}` : ''}

תובנות בעלות השפעה גבוהה השבוע:
${topSignals.length > 0 ? topSignals.join('\n') : '• אין תובנות בעלות השפעה גבוהה השבוע'}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "summary": "2-3 sentences about the week — cite numbers, service names, and a clear trend. Not generic.",
  "highlight": "the single most important thing that happened this week — one specific sentence with a number or name",
  "next_week_action": "one specific action + channel + timeline (no more than 12 words)",
  "score": 0,
  "score_reason": "brief rationale for the score — what determined it (positive / negative)"
}
Score rule: 1-10. 10=excellent week. 7+=above average. 5=average. 3-=tough week. Score is based on: lead volume, conversion, reviews, opportunities identified.`,
      response_json_schema: { type: 'object' },
    });

    const response = { report: result, stats };
    _weeklyCache.set(cacheKey, { result: response, date: todayDate });
    return res.json(response);
  } catch (err: any) {
    console.error('[generateWeeklyReport] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
