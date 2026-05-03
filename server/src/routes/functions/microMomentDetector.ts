import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getSectorContext } from '../../lib/sectorPrompts';

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
      prompt: `אתה מנוע זיהוי "מיקרו-רגעים" לעסק "${profile.name}" (${profile.category}, ${profile.city}).

תאריך היום: ${now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })} (${dayOfWeek})
חודש נוכחי: ${currentMonth} | חודש הבא: ${nextMonth}
${peakInfo}
${sectorCtx}

מיקרו-רגעים הם רגעים ספציפיים שבהם אנשים הכי נוטים לחפש ולקנות שירות זה:
- אחרי אירועי מזג אוויר (חום גל → מזגנים, גשם → אינסטלטורים)
- לפני חגים ישראליים (ראש השנה, פסח, ל"ג בעומר)
- תחילת/סוף עונות (בית ספר, קיץ, חורף)
- אירועי חיים (חתונות, לידות, מעבר דירה)
- ימי שבוע ושעות ספציפיות לסקטור זה

זהה 3-4 מיקרו-רגעים שיגיעו ב-30-60 הימים הקרובים:

החזר JSON:
{
  "moments": [{
    "title": "שם המיקרו-רגע (קצר)",
    "description": "מה קורה ולמה זו הזדמנות לעסק זה",
    "days_until": 1-60,
    "demand_multiplier": 1.2-5.0,
    "recommended_action": "פעולה שיווקית ספציפית לנצל את הרגע",
    "content_idea": "רעיון לפוסט/מסר שיווקי לאותו רגע",
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
