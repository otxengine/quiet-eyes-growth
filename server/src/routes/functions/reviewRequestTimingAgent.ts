/**
 * reviewRequestTimingAgent — finds the optimal time to send review requests
 * by analysing when customers actually leave reviews (day-of-week + hour patterns).
 *
 * Flow:
 *  1. Load all existing reviews for this business
 *  2. Bucket them by day-of-week and hour
 *  3. Identify peak review submission windows (proxy for when customers are most receptive)
 *  4. Check for recent closed/completed leads that haven't received a review request
 *  5. Save MarketSignal with timing recommendation
 *  6. ProactiveAlert: "Best time to send review requests: {day} {hour}" + ready-to-use WhatsApp text
 *
 * Delta guard: 48h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';

const MIN_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h

export async function reviewRequestTimingAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (shouldSkipAgent(businessProfileId, 'reviewRequestTimingAgent', MIN_INTERVAL_MS)) {
    return res.json({ insights_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

    // ── 1. Load recent reviews with timestamps ────────────────────────────────
    const reviews = await prisma.review.findMany({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: sixtyDaysAgo },
      },
      select: { created_at: true, created_date: true, rating: true, sentiment: true },
      take: 200,
    });

    // ── 2. Bucket by day-of-week and hour ─────────────────────────────────────
    const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const dayBuckets: number[] = new Array(7).fill(0);
    const hourBuckets: number[] = new Array(24).fill(0);

    for (const r of reviews) {
      const ts = r.created_at || r.created_date?.toISOString();
      if (!ts) continue;
      const d = new Date(ts);
      dayBuckets[d.getDay()]++;
      hourBuckets[d.getHours()]++;
    }

    // Peak day and hour
    const peakDayIdx = dayBuckets.indexOf(Math.max(...dayBuckets));
    const peakHourIdx = hourBuckets.indexOf(Math.max(...hourBuckets));
    const peakDayName = DAY_NAMES_HE[peakDayIdx];
    const peakHour = `${peakHourIdx.toString().padStart(2, '0')}:00`;

    // Second-best time (for recommendation variety)
    const sortedDays = [...dayBuckets.entries()].sort((a, b) => b[1] - a[1]);
    const secondDayIdx = sortedDays[1]?.[0] ?? peakDayIdx;
    const secondDayName = DAY_NAMES_HE[secondDayIdx];

    // ── 3. Find recent closed leads without a review request ──────────────────
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    const recentClosedLeads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        OR: [
          { status: { in: ['closed_won', 'completed'] } },
          { lifecycle_stage: 'closed_won' },
        ],
        created_date: { gte: fourteenDaysAgo },
        contact_phone: { not: null },
      },
      select: { id: true, name: true, contact_phone: true, service_needed: true },
      take: 10,
    });

    // Filter out those already sent a review request
    const existingRequests = await prisma.reviewRequest.findMany({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: fourteenDaysAgo },
      },
      select: { lead_id: true },
    });
    const requestedIds = new Set(existingRequests.map(r => r.lead_id).filter(Boolean));
    const uncontactedLeads = recentClosedLeads.filter(l => !requestedIds.has(l.id));

    // ── 4. Build timing summary ───────────────────────────────────────────────
    const topDaysFormatted = sortedDays
      .slice(0, 3)
      .map(([idx, count]) => `${DAY_NAMES_HE[idx]}: ${count} ביקורות`)
      .join(', ');

    const topHoursFormatted = [...hourBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([h, count]) => `${h}:00–${h + 1}:00 (${count})`)
      .join(', ');

    // ── 5. LLM: generate optimal timing message ───────────────────────────────
    const reviewLink = profile.google_place_id
      ? `https://search.google.com/local/writereview?placeid=${profile.google_place_id}`
      : null;

    const sampleLead = uncontactedLeads[0];

    const analysis: any = await invokeLLM({
      model: 'haiku',
      maxTokens: 400,
      prompt: `אתה מומחה לבקשות ביקורות גוגל לעסקים ישראלים.

עסק: "${profile.name}" | ${profile.category} | ${profile.city}
ביקורות ב-60 יום: ${reviews.length}
ימים עם הכי הרבה ביקורות: ${topDaysFormatted}
שעות שיא: ${topHoursFormatted}
לידים שסיימו ולא קיבלו בקשה: ${uncontactedLeads.length}
${sampleLead ? `לקוח לדוגמה: ${sampleLead.name || 'לקוח'} (${sampleLead.service_needed || profile.category})` : ''}

המלץ על:
1. הזמן הטוב ביותר לשלוח בקשת ביקורת
2. כתוב הודעת וואטסאפ קצרה לבקשת ביקורת (2 שורות)

החזר JSON בלבד:
{
  "best_day": "יום השבוע הטוב ביותר לשליחה",
  "best_hour": "שעה מומלצת (HH:00)",
  "reason": "מדוע זה הזמן הטוב ביותר — משפט אחד",
  "whatsapp_template": "הודעת וואטסאפ מוכנה לשליחה בעברית${reviewLink ? ' — כלול קישור' : ''}",
  "urgency": "high|medium"
}`,
      response_json_schema: { type: 'object' },
    });

    // ── 6. Save MarketSignal ──────────────────────────────────────────────────
    const bestDay = analysis?.best_day || peakDayName;
    const bestHour = analysis?.best_hour || peakHour;
    const template = analysis?.whatsapp_template || '';

    const signalSummary = `זמן מיטבי לבקשת ביקורת: ${bestDay} ${bestHour}${uncontactedLeads.length > 0 ? ` | ${uncontactedLeads.length} לקוחות ממתינים` : ''}`;

    const existingSignal = await prisma.marketSignal.findFirst({
      where: {
        linked_business: businessProfileId,
        category: 'review_timing',
        detected_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() },
      },
    });

    let insightsCreated = 0;
    if (!existingSignal) {
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: signalSummary,
          category: 'review_timing',
          impact_level: uncontactedLeads.length > 2 ? 'high' : 'medium',
          confidence: reviews.length >= 10 ? 85 : 60,
          recommended_action: `שלח בקשות ביקורת ב${bestDay} בשעה ${bestHour}`,
          source_description: JSON.stringify({
            action_type: 'whatsapp_send',
            action_label: `שלח ב${bestDay} ${bestHour}`,
            best_day: bestDay,
            best_hour: bestHour,
            peak_day_data: topDaysFormatted,
            peak_hour_data: topHoursFormatted,
            reviews_analyzed: reviews.length,
            uncontacted_leads: uncontactedLeads.length,
            whatsapp_template: template,
            urgency_hours: 48,
          }),
          is_read: false,
          detected_at: new Date().toISOString(),
        },
      });
      insightsCreated++;
    }

    // ── 7. ProactiveAlert if uncontacted leads exist ──────────────────────────
    if (uncontactedLeads.length > 0) {
      const alertTitle = `${uncontactedLeads.length} לקוחות ממתינים לבקשת ביקורת (זמן מיטבי: ${bestDay} ${bestHour})`;
      const alertExists = await prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
      });
      if (!alertExists) {
        const prefilledText = template || `שלום ${sampleLead?.name || 'לקוח יקר'}, תודה שבחרת ב${profile.name}! נשמח אם תשאיר לנו ביקורת קצרה על השירות${reviewLink ? ` 🙏\n${reviewLink}` : '.'}`;
        await prisma.proactiveAlert.create({
          data: {
            alert_type: 'market_opportunity',
            title: alertTitle,
            description: `${uncontactedLeads.length} לקוחות שסיימו טיפול לא קיבלו בקשת ביקורת. זמן שליחה מומלץ: ${bestDay} ${bestHour} — ${analysis?.reason || 'זמן שיא לקבלת ביקורות'}`,
            suggested_action: `שלח בקשות ביקורת ב${bestDay} ${bestHour}`,
            priority: uncontactedLeads.length >= 3 ? 'high' : 'medium',
            source_agent: JSON.stringify({
              action_label: 'שלח בקשות ביקורת',
              action_type: 'whatsapp_send',
              prefilled_text: prefilledText,
              urgency_hours: 48,
              impact_reason: `ביקורת Google נוספת מגדילה המרה מקומית ב-15% — ${uncontactedLeads.length} לקוחות מוכנים`,
            }),
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        }).catch(() => {});
        insightsCreated++;
      }
    }

    setLastRun(businessProfileId, 'reviewRequestTimingAgent');
    await writeAutomationLog('reviewRequestTimingAgent', businessProfileId, startTime, insightsCreated);
    console.log(`[reviewRequestTimingAgent] done: ${reviews.length} reviews analysed, best time: ${bestDay} ${bestHour}, ${uncontactedLeads.length} uncontacted leads`);

    return res.json({
      reviews_analyzed: reviews.length,
      best_day: bestDay,
      best_hour: bestHour,
      uncontacted_leads: uncontactedLeads.length,
      insights_created: insightsCreated,
    });

  } catch (err: any) {
    console.error('[reviewRequestTimingAgent] error:', err.message);
    await writeAutomationLog('reviewRequestTimingAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
