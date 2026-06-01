import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * sectorBenchmark — compares a business's metrics against sector averages
 * sourced from SectorKnowledge + hardcoded category baselines.
 */

const SECTOR_DEFAULTS: Record<string, {
  avg_rating: number; response_rate: number; conversion_rate: number;
  weekly_leads: number; avg_lead_score: number;
}> = {
  'מסעדה':    { avg_rating: 4.1, response_rate: 0.45, conversion_rate: 0.12, weekly_leads: 8,  avg_lead_score: 55 },
  restaurant:  { avg_rating: 4.1, response_rate: 0.45, conversion_rate: 0.12, weekly_leads: 8,  avg_lead_score: 55 },
  'יופי':     { avg_rating: 4.4, response_rate: 0.55, conversion_rate: 0.25, weekly_leads: 12, avg_lead_score: 60 },
  beauty:      { avg_rating: 4.4, response_rate: 0.55, conversion_rate: 0.25, weekly_leads: 12, avg_lead_score: 60 },
  'כושר':     { avg_rating: 4.3, response_rate: 0.50, conversion_rate: 0.20, weekly_leads: 15, avg_lead_score: 58 },
  fitness:     { avg_rating: 4.3, response_rate: 0.50, conversion_rate: 0.20, weekly_leads: 15, avg_lead_score: 58 },
  'שיפוצים':  { avg_rating: 4.2, response_rate: 0.35, conversion_rate: 0.30, weekly_leads: 5,  avg_lead_score: 65 },
  renovation:  { avg_rating: 4.2, response_rate: 0.35, conversion_rate: 0.30, weekly_leads: 5,  avg_lead_score: 65 },
  'רפואה':    { avg_rating: 4.5, response_rate: 0.60, conversion_rate: 0.35, weekly_leads: 10, avg_lead_score: 70 },
  health:      { avg_rating: 4.5, response_rate: 0.60, conversion_rate: 0.35, weekly_leads: 10, avg_lead_score: 70 },
  default:     { avg_rating: 4.2, response_rate: 0.45, conversion_rate: 0.18, weekly_leads: 8,  avg_lead_score: 58 },
};

function getSectorBaseline(category: string) {
  if (!category) return SECTOR_DEFAULTS.default;
  const lower = category.toLowerCase();
  for (const [key, val] of Object.entries(SECTOR_DEFAULTS)) {
    if (lower.includes(key)) return val;
  }
  return SECTOR_DEFAULTS.default;
}

export async function sectorBenchmark(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [reviews, leads, sectorKnowledge] = await Promise.all([
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        select: { rating: true, sentiment: true, response_status: true, created_date: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        select: { status: true, score: true, created_date: true },
      }),
      prisma.sectorKnowledge.findFirst({ where: { sector: profile.category || '' } }),
    ]);

    // Business metrics
    const avgRating = reviews.length > 0
      ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length
      : 0;
    const respondedStatuses = ['responded', 'auto_responded', 'suggested', 'published'];
    const responseRate = reviews.length > 0
      ? reviews.filter(r => respondedStatuses.includes(r.response_status || '')).length / reviews.length
      : 0;
    const completedLeads = leads.filter(l => ['completed', 'closed_won'].includes(l.status || '')).length;
    const conversionRate = leads.length > 0 ? completedLeads / leads.length : 0;
    const avgLeadScore = leads.length > 0
      ? leads.reduce((s, l) => s + (l.score || 50), 0) / leads.length
      : 50;
    const weeklyLeads = leads.filter(l => (l.created_date || '') >= weekAgo).length;

    // Sector baseline — override with SectorKnowledge if available
    const baselines = getSectorBaseline(profile.category || '');
    let sectorWinnerDNA: any = {};
    if (sectorKnowledge?.winner_lead_dna) {
      try { sectorWinnerDNA = JSON.parse(sectorKnowledge.winner_lead_dna as string); } catch {}
    }
    if (sectorWinnerDNA.avg_conversion_rate) baselines.conversion_rate = sectorWinnerDNA.avg_conversion_rate;

    const comparisons = [
      {
        metric: 'דירוג ממוצע',
        your_value: Math.round(avgRating * 10) / 10,
        sector_avg: baselines.avg_rating,
        unit: '⭐',
        better: avgRating > 0 && avgRating >= baselines.avg_rating,
        delta: Math.round((avgRating - baselines.avg_rating) * 10) / 10,
        no_data: reviews.length === 0,
      },
      {
        metric: 'שיעור תגובה לביקורות',
        your_value: Math.round(responseRate * 100),
        sector_avg: Math.round(baselines.response_rate * 100),
        unit: '%',
        better: responseRate >= baselines.response_rate,
        delta: Math.round((responseRate - baselines.response_rate) * 100),
        no_data: reviews.length === 0,
      },
      {
        metric: 'שיעור המרת לידים',
        your_value: Math.round(conversionRate * 100),
        sector_avg: Math.round(baselines.conversion_rate * 100),
        unit: '%',
        better: conversionRate >= baselines.conversion_rate,
        delta: Math.round((conversionRate - baselines.conversion_rate) * 100),
        no_data: leads.length === 0,
      },
      {
        metric: 'לידים שבועיים',
        your_value: weeklyLeads,
        sector_avg: baselines.weekly_leads,
        unit: '',
        better: weeklyLeads >= baselines.weekly_leads,
        delta: weeklyLeads - baselines.weekly_leads,
        no_data: false,
      },
      {
        metric: 'ציון ליד ממוצע',
        your_value: Math.round(avgLeadScore),
        sector_avg: baselines.avg_lead_score,
        unit: '/100',
        better: avgLeadScore >= baselines.avg_lead_score,
        delta: Math.round(avgLeadScore - baselines.avg_lead_score),
        no_data: leads.length === 0,
      },
    ];

    const validComparisons = comparisons.filter(c => !c.no_data);
    const aboveAvgCount = validComparisons.filter(c => c.better).length;
    const overallPercentile = validComparisons.length > 0
      ? Math.round((aboveAvgCount / validComparisons.length) * 100)
      : 50;

    return res.json({
      sector: profile.category,
      comparisons,
      overall_percentile: overallPercentile,
      above_avg_count: aboveAvgCount,
      total_metrics: validComparisons.length,
      sector_winner_insight: sectorWinnerDNA.top_services?.length
        ? `השירותים המנצחים בסקטור: ${(sectorWinnerDNA.top_services as string[]).join(', ')}`
        : null,
      top_improvement: validComparisons
        .filter(c => !c.better)
        .sort((a, b) => a.delta - b.delta)[0]?.metric || null,
    });
  } catch (err: any) {
    console.error('[sectorBenchmark] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
