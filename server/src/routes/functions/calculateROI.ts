import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * calculateROI — computes system-generated revenue impact.
 *
 * Logic:
 *  1. Find all closed/completed leads with revenue values
 *  2. Identify system-attributed leads (source = agent/scan/ai/otx)
 *  3. For leads without explicit value, use category-based avg deal size
 *  4. Build monthly breakdown (last 6 months)
 *  5. Compute ROI % vs subscription cost
 */

const CATEGORY_AVG_DEAL: Record<string, number> = {
  'מסעדה': 180, restaurant: 180,
  'יופי': 350, beauty: 350,
  'כושר': 280, fitness: 280,
  'רפואה': 600, health: 600,
  'נדלן': 8000, 'real estate': 8000,
  'עורך דין': 1200, lawyer: 1200,
  'שיפוצים': 3500, renovation: 3500,
  'default': 500,
};

function getAvgDeal(category: string): number {
  if (!category) return CATEGORY_AVG_DEAL.default;
  const lower = category.toLowerCase();
  for (const [key, val] of Object.entries(CATEGORY_AVG_DEAL)) {
    if (lower.includes(key)) return val;
  }
  return CATEGORY_AVG_DEAL.default;
}

const SYSTEM_SOURCES = ['agent', 'scan', 'ai', 'otx', 'signal', 'whatsapp_bot', 'findSocialLeads', 'runLeadGeneration', 'social_lead'];

function isSystemLead(source: string | null): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return SYSTEM_SOURCES.some(k => s.includes(k));
}

const PLAN_COSTS: Record<string, number> = { pro: 299, growth: 499, starter: 149, free_trial: 0 };

export async function calculateROI(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const avgDeal = getAvgDeal(profile.category || '');

    const [closedLeads, allLeads, autoActions] = await Promise.all([
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: { in: ['completed', 'closed_won'] } },
        select: {
          id: true, source: true, closed_value: true, total_value: true,
          created_date: true, closed_at: true, service_needed: true, name: true,
        },
        orderBy: { created_date: 'desc' },
        take: 200,
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        select: { id: true, source: true, status: true, created_date: true },
        take: 500,
      }),
      prisma.autoAction.findMany({
        where: { linked_business: businessProfileId, status: 'completed' },
        select: { id: true, revenue_impact: true, created_date: true },
        take: 200,
      }),
    ]);

    const totalLeads = allLeads.length;
    const systemLeadsCount = allLeads.filter(l => isSystemLead(l.source)).length;
    const systemAttributionRate = totalLeads > 0 ? systemLeadsCount / totalLeads : 0;

    let totalRevenue = 0;
    let systemRevenue = 0;
    const closedByMonth: Record<string, { total: number; system: number; count: number }> = {};

    for (const lead of closedLeads) {
      const value = (lead as any).closed_value || (lead as any).total_value || avgDeal;
      const dateKey = ((lead as any).closed_at || lead.created_date || '').toString().slice(0, 7);
      if (!closedByMonth[dateKey]) closedByMonth[dateKey] = { total: 0, system: 0, count: 0 };
      closedByMonth[dateKey].total += value;
      closedByMonth[dateKey].count++;
      totalRevenue += value;
      if (isSystemLead(lead.source)) {
        systemRevenue += value;
        closedByMonth[dateKey].system += value;
      }
    }

    const autoActionRevenue = autoActions.reduce((s, a) => s + ((a as any).revenue_impact || 0), 0);

    // Monthly breakdown — last 6 months
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      const key = d.toISOString().slice(0, 7);
      return {
        month: d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' }),
        total: closedByMonth[key]?.total || 0,
        system: closedByMonth[key]?.system || 0,
        count: closedByMonth[key]?.count || 0,
      };
    });

    const subscriptionMonthly = PLAN_COSTS[(profile as any).plan || 'starter'] || 299;
    const totalSystemImpact = systemRevenue + autoActionRevenue;
    const roiPercent = subscriptionMonthly > 0
      ? Math.round((totalSystemImpact / subscriptionMonthly) * 100)
      : 0;
    const paybackDays = totalSystemImpact > 0 && subscriptionMonthly > 0
      ? Math.round(subscriptionMonthly / (totalSystemImpact / 30))
      : null;

    const conversionRate = totalLeads > 0
      ? Math.round((closedLeads.length / totalLeads) * 100)
      : 0;

    await writeAutomationLog('calculateROI', businessProfileId, startTime, 1);

    return res.json({
      summary: {
        total_revenue: Math.round(totalRevenue),
        system_attributed_revenue: Math.round(systemRevenue),
        auto_action_revenue: Math.round(autoActionRevenue),
        total_system_impact: Math.round(totalSystemImpact),
        subscription_cost_monthly: subscriptionMonthly,
        roi_percent: roiPercent,
        payback_days: paybackDays,
        attribution_rate: Math.round(systemAttributionRate * 100),
        conversion_rate: conversionRate,
        closed_leads: closedLeads.length,
        system_leads: systemLeadsCount,
        total_leads: totalLeads,
        avg_deal_size: avgDeal,
      },
      monthly_breakdown: months,
    });
  } catch (err: any) {
    console.error('[calculateROI] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
