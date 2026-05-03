import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * marketMemoryEngine — learns how the market behaves over time for this business.
 * Detects seasonal patterns, recurring demand peaks, and behavioral cycles.
 * Stores learned patterns in BusinessMemory and creates ProactiveAlerts for upcoming peaks.
 */
export async function marketMemoryEngine(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const oneYearAgo = new Date(Date.now() - 365 * 86400000);

    // Load all historical data
    const [reviews, leads, signals, closedLeads] = await Promise.all([
      prisma.review.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: oneYearAgo } },
        select: { rating: true, sentiment: true, created_date: true, created_at: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: oneYearAgo } },
        select: { status: true, score: true, created_date: true, deal_value: true, closed_at: true },
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: oneYearAgo } },
        select: { category: true, impact_level: true, created_date: true },
        take: 200,
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: 'closed_won', created_date: { gte: oneYearAgo } },
        select: { deal_value: true, closed_at: true, created_date: true },
      }),
    ]);

    // Bucket by month (0=Jan .. 11=Dec)
    const monthlyStats: Record<number, { reviews: number; negReviews: number; leads: number; signals: number; closedDeals: number; revenue: number }> = {};
    for (let m = 0; m < 12; m++) {
      monthlyStats[m] = { reviews: 0, negReviews: 0, leads: 0, signals: 0, closedDeals: 0, revenue: 0 };
    }

    reviews.forEach(r => {
      const m = new Date(r.created_date).getMonth();
      monthlyStats[m].reviews++;
      if (r.sentiment === 'negative' || (r.rating && r.rating <= 2)) monthlyStats[m].negReviews++;
    });
    leads.forEach(l => {
      const m = new Date(l.created_date).getMonth();
      monthlyStats[m].leads++;
    });
    signals.forEach(s => {
      const m = new Date(s.created_date).getMonth();
      monthlyStats[m].signals++;
    });
    closedLeads.forEach(l => {
      const dateStr = l.closed_at || l.created_date.toISOString();
      const m = new Date(dateStr).getMonth();
      monthlyStats[m].closedDeals++;
      monthlyStats[m].revenue += l.deal_value || 0;
    });

    const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const currentMonth = new Date().getMonth();

    const statsBlock = Object.entries(monthlyStats)
      .map(([m, s]) => `${MONTHS_HE[Number(m)]}: ביקורות=${s.reviews} לידים=${s.leads} עסקאות=${s.closedDeals} הכנסות=₪${s.revenue.toFixed(0)}`)
      .join('\n');

    const result = await invokeLLM({
      prompt: `אתה מנוע ניתוח שוק לעסק "${profile.name}" (${profile.category}, ${profile.city}).
ניתחת נתונים היסטוריים של 12 חודשים:

${statsBlock}

החודש הנוכחי: ${MONTHS_HE[currentMonth]}

זהה:
1. חודשי שיא בביקוש (לידים/עסקאות גבוהים מהממוצע)
2. חודשים שקטים שדורשים שיווק פרואקטיבי
3. תבניות עונתיות חוזרות
4. רגעי שוק קריטיים צפויים ב-60 הימים הקרובים
5. תבנית התנהגות לקוחות (מתי הם מחפשים, מתי הם קונים)

החזר JSON:
{
  "peak_months": [{ "month": "שם חודש", "reason": "למה שיא", "demand_index": 1.0-3.0 }],
  "slow_months": [{ "month": "שם חודש", "action": "מה לעשות בתקופה שקטה" }],
  "seasonal_patterns": ["תבנית 1", "תבנית 2"],
  "upcoming_opportunities": [{ "timeframe": "2-4 שבועות", "description": "הזדמנות ספציפית", "recommended_action": "פעולה" }],
  "behavioral_insights": ["תובנה על התנהגות לקוחות 1", "תובנה 2"]
}`,
      response_json_schema: { type: 'object' },
    });

    // Store patterns in BusinessMemory
    const existingMemory = await prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } });
    const marketPatterns = JSON.stringify({
      peak_months: result?.peak_months || [],
      slow_months: result?.slow_months || [],
      seasonal_patterns: result?.seasonal_patterns || [],
      behavioral_insights: result?.behavioral_insights || [],
      last_analyzed: new Date().toISOString(),
      data_months: Object.keys(monthlyStats).filter(m => monthlyStats[Number(m)].leads > 0 || monthlyStats[Number(m)].reviews > 0).length,
    });

    if (existingMemory) {
      await prisma.businessMemory.update({
        where: { id: existingMemory.id },
        data: { feedback_summary: marketPatterns, last_updated: new Date().toISOString() },
      });
    } else {
      await prisma.businessMemory.create({
        data: { linked_business: businessProfileId, feedback_summary: marketPatterns, last_updated: new Date().toISOString() },
      });
    }

    // Create ProactiveAlerts for upcoming opportunities (next 60 days)
    let alertsCreated = 0;
    for (const opp of (result?.upcoming_opportunities || []).slice(0, 2)) {
      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'market_pattern',
          title: `הזדמנות עונתית: ${opp.description}`,
          description: `בעוד ${opp.timeframe} — ${opp.description}`,
          suggested_action: opp.recommended_action || '',
          priority: 'medium',
          source_agent: JSON.stringify({ action_label: 'הכן עכשיו', action_type: 'task', urgency_hours: 336 }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      alertsCreated++;
    }

    await writeAutomationLog('marketMemoryEngine', businessProfileId, startTime, alertsCreated);
    return res.json({ patterns: result, alerts_created: alertsCreated, months_analyzed: Object.keys(monthlyStats).length });
  } catch (err: any) {
    console.error('marketMemoryEngine error:', err.message);
    await writeAutomationLog('marketMemoryEngine', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
