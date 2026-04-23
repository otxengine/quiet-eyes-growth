import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

export async function generateMorningBriefing(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const [profiles, reviews, leads, competitors, signals, weeklyReports] = await Promise.all([
      prisma.businessProfile.findMany({ where: { id: businessProfileId } }),
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId }, orderBy: { score: 'desc' }, take: 30 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId, is_read: false }, orderBy: { created_date: 'desc' }, take: 10 }),
      prisma.weeklyReport.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 1 }),
    ]);

    const bp = profiles[0];
    if (!bp) return res.status(404).json({ error: 'Business profile not found' });

    const pendingReviews = reviews.filter(r => r.response_status === 'pending');
    const negativeReviews = pendingReviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2));
    const hotLeads = leads.filter(l => l.status === 'hot');
    const todayStr = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const newLeadsToday = leads.filter(l => (l.created_at || '').startsWith(todayStr));
    const closedThisMonth = leads.filter(l =>
      (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
      (l.closed_at || '').startsWith(thisMonth)
    );
    const monthRevenue = closedThisMonth.reduce((s, l) => s + (l.closed_value || l.total_value || 0), 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const changedCompetitors = competitors.filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);
    const highImpactSignals = signals.filter(s => s.impact_level === 'high');
    const avgRating = reviews.filter(r => r.rating).length > 0
      ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.filter(r => r.rating).length).toFixed(1)
      : null;
    const weeklyScore = weeklyReports[0]?.weekly_score || null;
    const totalSources = reviews.length + leads.length + competitors.length + signals.length;

    const prompt = `You are a business intelligence advisor for "${bp.name}", a ${bp.category} business in ${bp.city}.

CURRENT DATA:
- Negative reviews pending: ${negativeReviews.length}
- Total pending reviews: ${pendingReviews.length}
- Hot leads: ${hotLeads.length}
- New leads today: ${newLeadsToday.length}
- Competitor changes: ${changedCompetitors.map(c => `${c.name}: שינוי מחירים`).join('; ') || 'אין שינויים'}
- High-impact signals: ${highImpactSignals.slice(0, 3).map(s => s.summary).join('; ') || 'None'}
- Unread signals: ${signals.length}
- Average review rating: ${avgRating || 'N/A'}
- Weekly score: ${weeklyScore || 'N/A'}/10
- הכנסות החודש: ₪${monthRevenue > 0 ? monthRevenue.toLocaleString() : 0}

Write a morning briefing in Hebrew — exactly 3-4 lines max.
Each line starts with an emoji: 🔴 = urgent, 🟢 = opportunity, 🟡 = watch, 📊 = info
Rules: Be SPECIFIC with real numbers. If nothing urgent: "הכל שקט — המערכת ממשיכה לעקוב."
Each line max 60 chars. Link mapping: reviews→/reviews, leads→/leads, competitors→/competitors, signals→/signals

Also generate today_actions: up to 3 concrete Hebrew actions for TODAY based on the data.
Each: { "action": "פעולה ספציפית", "type": "review|lead|signal|competitor", "priority": 1|2|3 }
priority 1=urgent (red), 2=important (orange), 3=helpful (green). Only include if real items exist.

Return ONLY valid JSON:
{"lines":[{"emoji":"🔴","text":"...","link":"/reviews","type":"urgent"}],"weekly_score":${weeklyScore || 6.5},"score_trend":"stable","source_count":${totalSources},"today_actions":[{"action":"...","type":"review","priority":1}]}`;

    const result = await invokeLLM({ prompt, response_json_schema: { type: 'object' } });

    if (result && monthRevenue > 0 && !result.month_revenue) {
      result.month_revenue = monthRevenue;
    }

    await writeAutomationLog('generateMorningBriefing', businessProfileId, startTime, 1);
    return res.json({
      briefing: result,
      generated_at: new Date().toISOString(),
      stats: {
        pendingReviews: pendingReviews.length,
        negativeReviews: negativeReviews.length,
        hotLeads: hotLeads.length,
        newLeadsToday: newLeadsToday.length,
        unreadSignals: signals.length,
        highImpactSignals: highImpactSignals.length,
        competitorChanges: changedCompetitors.length,
        totalCompetitors: competitors.length,
        totalReviews: reviews.length,
        totalLeads: leads.length,
        avgRating: avgRating ? parseFloat(avgRating) : null,
      }
    });
  } catch (err: any) {
    console.error('generateMorningBriefing error:', err.message);
    await writeAutomationLog('generateMorningBriefing', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
