import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getSectorContext } from '../../lib/sectorPrompts';
import { sendOwnerWhatsAppNotification } from '../../services/execution/WhatsAppOwnerNotifier';

/**
 * microMomentDetector — identifies upcoming high-propensity purchase moments.
 * Based on calendar, seasonality, weather patterns, and Israeli market cycles.
 * Creates ProactiveAlerts with alert_type='micro_moment'.
 */
export async function microMomentDetector(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    // Load business memory for seasonal patterns
    const [bizMemory, existingMoments] = await Promise.all([
      prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } }),
      prisma.proactiveAlert.findMany({
        where: {
          linked_business: businessProfileId,
          alert_type: 'micro_moment',
          is_dismissed: false,
          is_acted_on: false,
        },
        select: { title: true },
      }),
    ]);

    const existingTitles = new Set(existingMoments.map(a => a.title));

    let marketPatterns: any = {};
    try {
      if (bizMemory?.feedback_summary) {
        marketPatterns = JSON.parse(bizMemory.feedback_summary);
      }
    } catch {}

    const now = new Date();
    const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const currentMonth = MONTHS_HE[now.getMonth()];
    const nextMonth = MONTHS_HE[(now.getMonth() + 1) % 12];
    const dayOfWeek = now.toLocaleDateString('he-IL', { weekday: 'long' });
    const sectorCtx = getSectorContext(profile.category);

    const peakInfo = marketPatterns.peak_months
      ? `חודשי שיא שזוהו: ${marketPatterns.peak_months.map((p: any) => p.month).join(', ')}`
      : '';

    const result = await invokeLLM({
      prompt: `You are a "micro-moment" detection engine for the business "${profile.name}" (${profile.category}, ${profile.city}).
Return ONLY valid JSON. ALL string values must be in Hebrew.

Today's date: ${now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })} (${dayOfWeek})
Current month: ${currentMonth} | Next month: ${nextMonth}
${peakInfo}
${sectorCtx}

Micro-moments are specific moments when people are most likely to search for and buy this service:
- After weather events (heat wave → air conditioning, rain → plumbers)
- Before Israeli holidays (Rosh Hashana, Passover, Lag BaOmer)
- Start/end of seasons (school year, summer, winter)
- Life events (weddings, births, moving homes)
- Specific weekdays and hours for this sector

Identify 3-4 micro-moments arriving in the next 30-60 days.

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "moments": [{
    "title": "micro-moment name (short, in Hebrew)",
    "description": "what happens and why this is an opportunity for this business (in Hebrew)",
    "days_until": 1-60,
    "demand_multiplier": 1.2-5.0,
    "recommended_action": "specific marketing action to capitalize on the moment (in Hebrew)",
    "content_idea": "idea for a post/marketing message for that moment (in Hebrew)",
    "urgency": "high|medium|low"
  }]
}`,
      response_json_schema: { type: 'object' },
    });

    const moments: any[] = (result?.moments || []).sort((a: any, b: any) => (a.days_until || 30) - (b.days_until || 30));
    let created = 0;

    for (const moment of moments.slice(0, 3)) {
      if (!moment.title) continue;
      if (existingTitles.has(moment.title)) continue;

      const urgencyHours = (moment.days_until || 14) * 24;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'micro_moment',
          title: moment.title,
          description: moment.description || '',
          suggested_action: moment.recommended_action || '',
          priority: moment.urgency === 'high' ? 'high' : moment.urgency === 'medium' ? 'medium' : 'low',
          source_agent: JSON.stringify({
            action_label: 'פרסם עכשיו',
            action_type: 'post_publish',
            prefilled_text: moment.content_idea || '',
            urgency_hours: urgencyHours,
            impact_reason: `ביקוש צפוי גבוה פי ${moment.demand_multiplier || 1.5} מהרגיל`,
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      // Notify owner via WhatsApp for high-urgency micro-moments (arriving within 7 days)
      if (moment.urgency === 'high' && (moment.days_until || 30) <= 7) {
        sendOwnerWhatsAppNotification({
          businessProfileId,
          actionDescription: `⏰ מיקרו-מומנט קרוב: ${moment.title} — בעוד ${moment.days_until || '?'} ימים. ביקוש צפוי גבוה פי ${moment.demand_multiplier || 1.5}`,
          agentName: 'זיהוי מיקרו-מומנטים',
        }).catch(() => {});
      }

      existingTitles.add(moment.title);
      created++;
    }

    await writeAutomationLog('microMomentDetector', businessProfileId, startTime, created);
    return res.json({ moments_detected: created, items_created: created });
  } catch (err: any) {
    console.error('microMomentDetector error:', err.message);
    await writeAutomationLog('microMomentDetector', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
