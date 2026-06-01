import { Request, Response } from 'express';
import { prisma } from '../../db';

/**
 * smartScheduler — analyzes historical data patterns to recommend
 * optimal agent run windows for a specific business.
 *
 * Returns: peak lead hours, peak review hours, recommended scan windows,
 *          day-of-week distribution, last scan info.
 */
export async function smartScheduler(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000).toISOString();

    const [leads, reviews, automationLogs] = await Promise.all([
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(sixMonthsAgo) } },
        select: { created_date: true, status: true },
        take: 500,
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(sixMonthsAgo) } },
        select: { created_date: true },
        take: 300,
      }),
      prisma.automationLog.findMany({
        where: { linked_business: businessProfileId, automation_name: 'runFullScan' },
        select: { created_date: true },
        orderBy: { created_date: 'desc' },
        take: 50,
      }),
    ]);

    // Hour-of-day distribution (Israel timezone UTC+3)
    const ISRAEL_OFFSET = 3;
    const leadHours = new Array(24).fill(0);
    const reviewHours = new Array(24).fill(0);
    const dayOfWeekLeads = new Array(7).fill(0);

    for (const lead of leads) {
      if (!lead.created_date) continue;
      const d = new Date(lead.created_date);
      const localHour = (d.getUTCHours() + ISRAEL_OFFSET) % 24;
      leadHours[localHour]++;
      dayOfWeekLeads[d.getDay()]++;
    }
    for (const review of reviews) {
      if (!review.created_date) continue;
      const d = new Date(review.created_date);
      reviewHours[(d.getUTCHours() + ISRAEL_OFFSET) % 24]++;
    }

    const peakLeadHours = leadHours
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter(h => h.count > 0)
      .map(h => h.hour);

    const peakReviewHours = reviewHours
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter(h => h.count > 0)
      .map(h => h.hour);

    const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const peakDayIdx = dayOfWeekLeads.indexOf(Math.max(...dayOfWeekLeads));

    // Recommended scan windows: 1 hour before peak lead activity
    let recommendedWindows: Array<{ hour: number; label: string; reason: string }> = [];

    if (peakLeadHours.length >= 2) {
      recommendedWindows = peakLeadHours.slice(0, 2).map(h => {
        const scanHour = Math.max(6, h - 1);
        return {
          hour: scanHour,
          label: `${String(scanHour).padStart(2, '0')}:00`,
          reason: `שעה לפני שיא הלידים (${String(h).padStart(2, '0')}:00)`,
        };
      });
    } else {
      // Israeli business defaults: morning scan + evening scan
      recommendedWindows = [
        { hour: 7, label: '07:00', reason: 'תחילת יום עסקים — זמן בדיקת WhatsApp גבוה' },
        { hour: 19, label: '19:00', reason: 'ערב — שיא גלישה וחיפושים בישראל' },
      ];
    }

    // How consistent are scan intervals
    const scanIntervals: number[] = [];
    for (let i = 1; i < automationLogs.length; i++) {
      const diff = new Date(automationLogs[i - 1].created_date).getTime() -
                   new Date(automationLogs[i].created_date).getTime();
      if (diff > 0) scanIntervals.push(diff / 3600000); // hours
    }
    const avgScanInterval = scanIntervals.length > 0
      ? Math.round(scanIntervals.reduce((a, b) => a + b, 0) / scanIntervals.length)
      : null;

    const lastScan = automationLogs[0]?.created_date || null;
    const hoursSinceLastScan = lastScan
      ? Math.round((now.getTime() - new Date(lastScan).getTime()) / 3600000)
      : null;

    return res.json({
      has_data: leads.length >= 5,
      peak_lead_hours: peakLeadHours,
      peak_review_hours: peakReviewHours,
      peak_day: dayNames[peakDayIdx] || 'ראשון',
      peak_day_index: peakDayIdx,
      recommended_windows: recommendedWindows,
      day_of_week_distribution: dayOfWeekLeads.map((count, i) => ({
        day: dayNames[i],
        day_short: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][i],
        count,
      })),
      scan_stats: {
        total_scans: automationLogs.length,
        avg_interval_hours: avgScanInterval,
        last_scan: lastScan,
        hours_since_last_scan: hoursSinceLastScan,
      },
      lead_count: leads.length,
    });
  } catch (err: any) {
    console.error('[smartScheduler] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
