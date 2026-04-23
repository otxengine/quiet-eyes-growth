import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { callClaude, parseClaudeJson } from '../_shared/claudeApi.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const startTime = new Date().toISOString();
    const { businessProfileId } = body;
    if (!businessProfileId) return Response.json({ error: 'Missing businessProfileId' }, { status: 400 });

    // Load ML cross-insights from SectorKnowledge
    let mlInsights: any[] = [];
    let mlSummary = '';
    try {
      const sk = await base44.asServiceRole.entities.SectorKnowledge.filter({ linked_business: businessProfileId });
      if (sk[0]?.agent_insights) {
        mlInsights = JSON.parse(sk[0].agent_insights) || [];
      }
    } catch (_) {}

    // Gather data
    const [reviews, leads, competitors, signals, weeklyReports] = await Promise.all([
      base44.asServiceRole.entities.Review.filter({ linked_business: businessProfileId }, '-created_date', 20),
      base44.asServiceRole.entities.Lead.filter({ linked_business: businessProfileId }, '-score', 30),
      base44.asServiceRole.entities.Competitor.filter({ linked_business: businessProfileId }),
      base44.asServiceRole.entities.MarketSignal.filter({ linked_business: businessProfileId, is_read: false }, '-detected_at', 10),
      base44.asServiceRole.entities.WeeklyReport.filter({ linked_business: businessProfileId }, '-created_date', 1),
    ]);

    const pendingReviews = reviews.filter(r => r.response_status === 'pending');
    const negativeReviews = pendingReviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2));
    const hotLeads = leads.filter(l => l.status === 'hot');
    const todayStr = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const newLeadsToday = leads.filter(l => (l.created_at || l.created_date || '').startsWith(todayStr));

    // Revenue attribution
    const closedThisMonth = leads.filter(l =>
      (l.lifecycle_stage === 'closed_won' || l.status === 'completed') &&
      (l.closed_at || l.created_at || '').startsWith(thisMonth)
    );
    const monthRevenue = closedThisMonth.reduce((sum: number, l: any) => sum + (l.closed_value || l.total_value || 0), 0);
    const highImpactSignals = signals.filter(s => s.impact_level === 'high');
    const weeklyScore = weeklyReports[0]?.weekly_score || null;
    const ratedReviews = reviews.filter(r => r.rating);
    const avgRating = ratedReviews.length > 0 ? (ratedReviews.reduce((s, r) => s + r.rating, 0) / ratedReviews.length).toFixed(1) : null;

    // Competitor changes (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const changedCompetitors = competitors.filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);

    // Get business profile
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: businessProfileId });
    const bp = profiles[0];
    if (!bp) return Response.json({ error: 'Business profile not found' }, { status: 404 });

    const dataContext = {
      negativeReviewCount: negativeReviews.length,
      negativeReviewDetails: negativeReviews.slice(0, 3).map(r => `${r.reviewer_name || 'אנונימי'} (${r.platform || 'לא ידוע'}): "${(r.text || '').slice(0, 80)}"`).join('; '),
      pendingReviewCount: pendingReviews.length,
      hotLeadCount: hotLeads.length,
      topServices: [...new Set(hotLeads.map(l => l.service_needed).filter(Boolean))].slice(0, 3).join(', '),
      newLeadsTodayCount: newLeadsToday.length,
      competitorChanges: changedCompetitors.map(c => `${c.name}: שינוי מחירים`).join('; ') || 'אין שינויים',
      highImpactSignals: highImpactSignals.slice(0, 3).map(s => s.summary).join('; '),
      unreadSignalCount: signals.length,
      avgRating,
      weeklyScore,
      monthRevenue,
    };

    const totalSources = reviews.length + leads.length + competitors.length + signals.length;

    const prompt = `You are a business intelligence advisor for "${bp.name}", a ${bp.category} business in ${bp.city}.

CURRENT DATA:
- Negative reviews pending: ${dataContext.negativeReviewCount} ${dataContext.negativeReviewDetails ? `(${dataContext.negativeReviewDetails})` : ''}
- Total pending reviews: ${dataContext.pendingReviewCount}
- Hot leads: ${dataContext.hotLeadCount} (top services: ${dataContext.topServices || 'N/A'})
- New leads today: ${dataContext.newLeadsTodayCount}
- Competitor changes: ${dataContext.competitorChanges}
- High-impact signals: ${dataContext.highImpactSignals || 'None'}
- Unread signals: ${dataContext.unreadSignalCount}
- Average review rating: ${dataContext.avgRating || 'N/A'}
- Weekly score: ${dataContext.weeklyScore || 'N/A'}/10
- הכנסות החודש שנרשמו דרך המערכת: ₪${dataContext.monthRevenue > 0 ? dataContext.monthRevenue.toLocaleString() : 0}
${mlInsights.length > 0 ? `- ML cross-insights: ${mlInsights.slice(0, 2).map((i: any) => i.insight).join(' | ')}` : ''}

Write a morning briefing in Hebrew — exactly 3-4 lines max.
Each line starts with an emoji indicating urgency:
🔴 = urgent, needs immediate action
🟢 = opportunity, act today
🟡 = watch, monitor
📊 = info, good to know

Rules:
- Be SPECIFIC — use real names, real numbers, real details from the data above.
- Every line must reference actual data, not generic advice.
- If nothing urgent happened, say: "הכל שקט — המערכת ממשיכה לעקוב."
- Each line should be concise (max 60 chars).
- Link mapping: reviews → /reviews, leads → /leads, competitors → /competitors, signals/info → /signals

Also create today_actions: 2-3 specific, prioritized tasks for TODAY based on the data.
Priority 1 = most urgent, 3 = least urgent.
Each action should be a specific, actionable sentence in Hebrew (max 50 chars).

Return ONLY valid JSON (no markdown):
{
  "lines": [
    {"emoji": "🔴", "text": "...", "link": "/reviews", "type": "urgent"},
    {"emoji": "🟢", "text": "...", "link": "/leads", "type": "opportunity"}
  ],
  "today_actions": [
    {"priority": 1, "action": "הגב לביקורת השלילית של...", "link": "/reviews"},
    {"priority": 2, "action": "צור קשר עם הליד החם...", "link": "/leads"}
  ],
  "weekly_score": ${dataContext.weeklyScore || 6.5},
  "score_trend": "up",
  "source_count": ${totalSources}
}`;

    // Try Claude first, fall back to Gemini
    let result: any = null;

    const claudeText = await callClaude(prompt, {
      systemPrompt: 'You are a business intelligence advisor. Return ONLY valid JSON, no markdown.',
      prefill: '{',
      maxTokens: 1024,
    });
    if (claudeText) {
      result = parseClaudeJson(claudeText, null);
    }

    if (!result) {
      result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  emoji: { type: "string" },
                  text: { type: "string" },
                  link: { type: "string" },
                  type: { type: "string" }
                }
              }
            },
            today_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "number" },
                  action: { type: "string" },
                  link: { type: "string" }
                }
              }
            },
            weekly_score: { type: "number" },
            score_trend: { type: "string" },
            source_count: { type: "number" },
            month_revenue: { type: "number" }
          }
        }
      });
    }

    // Inject month_revenue into briefing result (LLM may not return it)
    if (result && monthRevenue > 0 && !result.month_revenue) {
      result.month_revenue = monthRevenue;
    }

    try {
      await base44.asServiceRole.entities.AutomationLog.create({
        automation_name: 'generateMorningBriefing',
        start_time: startTime,
        end_time: new Date().toISOString(),
        status: 'success',
        items_processed: 1,
        linked_business: bp.id,
      });
    } catch (_) {}

    return Response.json({
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
  } catch (error) {
    console.error('generateMorningBriefing error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});