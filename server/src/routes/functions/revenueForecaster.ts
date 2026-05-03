import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * revenueForecaster — forecasts monthly revenue from leads pipeline + historical patterns.
 * Stores as Prediction with prediction_type='revenue_forecast'.
 * Also calculates Customer Lifetime Value (CLV) for active leads.
 */
export async function revenueForecaster(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);

    const [allLeads, closedLeads, bizMemory] = await Promise.all([
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: { in: ['hot', 'warm', 'new', 'contacted', 'proposal'] } },
        select: { status: true, score: true, budget_range: true, deal_value: true, total_value: true, service_needed: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: 'closed_won', created_date: { gte: ninetyDaysAgo } },
        select: { deal_value: true, closed_value: true, closed_at: true, created_date: true },
      }),
      prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } }),
    ]);

    // Historical metrics
    const avgDealValue = closedLeads.length > 0
      ? closedLeads.reduce((s, l) => s + (l.deal_value || l.closed_value || 0), 0) / closedLeads.length
      : 0;
    const monthlyCloseRate = closedLeads.length / 3; // avg per month over 3 months
    const hotLeads = allLeads.filter(l => l.status === 'hot');
    const warmLeads = allLeads.filter(l => l.status === 'warm' || l.score && l.score >= 60);

    // Pipeline value estimation
    const pipelineValue = allLeads.reduce((sum, l) => {
      const val = l.total_value || l.deal_value || avgDealValue;
      const prob = l.status === 'hot' ? 0.7 : l.status === 'proposal' ? 0.5 : l.status === 'warm' ? 0.3 : 0.15;
      return sum + val * prob;
    }, 0);

    // Seasonal adjustment from market memory
    let seasonalMemo: any = {};
    try {
      if (bizMemory?.feedback_summary) {
        seasonalMemo = JSON.parse(bizMemory.feedback_summary);
      }
    } catch {}
    const currentMonthHe = new Date().toLocaleDateString('he-IL', { month: 'long' });
    const isPeakMonth = (seasonalMemo.peak_months || []).some((p: any) => p.month === currentMonthHe);
    const seasonalMultiplier = isPeakMonth ? 1.3 : 1.0;

    const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const forecastMonth = MONTHS_HE[new Date().getMonth()];

    const result = await invokeLLM({
      prompt: `אתה אנליסט פיננסי לעסק "${profile.name}" (${profile.category}).

נתוני צינור עסקאות:
- לידים חמים (hot): ${hotLeads.length}
- לידים חמים-בינוניים (warm): ${warmLeads.length}
- סה"כ לידים פעילים: ${allLeads.length}
- ערך צינור משוקלל: ₪${pipelineValue.toFixed(0)}

נתונים היסטוריים (90 יום):
- ממוצע ערך עסקה: ₪${avgDealValue.toFixed(0)}
- ממוצע עסקאות סגורות לחודש: ${monthlyCloseRate.toFixed(1)}
- חודש שיא עונתי: ${isPeakMonth ? 'כן' : 'לא'} (מכפיל: ${seasonalMultiplier})

צור תחזית הכנסות ל${forecastMonth}:

החזר JSON:
{
  "forecast_month": "${forecastMonth}",
  "conservative_forecast": 0,
  "realistic_forecast": 0,
  "optimistic_forecast": 0,
  "expected_deals": 0,
  "key_assumptions": ["הנחה 1", "הנחה 2"],
  "growth_drivers": ["גורם צמיחה 1"],
  "risks": ["סיכון 1"],
  "recommended_actions": ["פעולה להגדלת ההכנסות 1", "פעולה 2"],
  "clv_estimate": 0
}`,
      response_json_schema: { type: 'object' },
    });

    if (!result) throw new Error('No LLM result');

    const forecastSummary = `תחזית ${forecastMonth}: ₪${(result.realistic_forecast || 0).toLocaleString()} | ${result.expected_deals || 0} עסקאות צפויות`;

    // Store as Prediction (upsert: replace existing revenue forecast)
    const existingForecast = await prisma.prediction.findFirst({
      where: { linked_business: businessProfileId, prediction_type: 'revenue_forecast' },
    });

    const predData = {
      linked_business: businessProfileId,
      prediction_type: 'revenue_forecast',
      title: forecastSummary,
      summary: JSON.stringify(result),
      confidence: 0.7,
      timeframe: '30 ימים',
      impact_level: 'high',
      recommended_actions: result.recommended_actions?.join('; ') || '',
      data_sources: 'leads_pipeline,historical_deals,market_memory',
      predicted_at: new Date().toISOString(),
      status: 'active',
    };

    if (existingForecast) {
      await prisma.prediction.update({ where: { id: existingForecast.id }, data: predData });
    } else {
      await prisma.prediction.create({ data: predData });
    }

    // Update CLV estimates on hot leads
    const clvPerLead = result.clv_estimate || avgDealValue * 2;
    if (clvPerLead > 0) {
      for (const lead of hotLeads) {
        if (!lead.total_value) {
          // Find the actual lead with id
        }
      }
      // Bulk update hot leads with CLV estimate
      await prisma.lead.updateMany({
        where: { linked_business: businessProfileId, status: 'hot', total_value: null },
        data: { total_value: clvPerLead },
      });
    }

    await writeAutomationLog('revenueForecaster', businessProfileId, startTime, 1);
    return res.json({ forecast: result, items_created: 1, pipeline_value: pipelineValue });
  } catch (err: any) {
    console.error('revenueForecaster error:', err.message);
    await writeAutomationLog('revenueForecaster', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
