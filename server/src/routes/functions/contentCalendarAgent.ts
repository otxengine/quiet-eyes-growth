import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { getSectorContext } from '../../lib/sectorPrompts';

const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * contentCalendarAgent — generates a 7-post weekly content plan every Sunday,
 * creates Task records for each post, and summarizes in a ProactiveAlert.
 */
export async function contentCalendarAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    // Load business context
    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const contentStyle = (bizCtx as any)?.contentStyle || '';
    const preferredChannels = (bizCtx as any)?.preferredChannels || 'instagram,facebook';

    const toneInstruction = tone === 'casual'
      ? 'טון קליל, חברותי, עם פאנץ\' ואמוג\'י. פוסטים מרגישים אנושיים'
      : tone === 'warm'
      ? 'טון חם ומוסמך, ספר סיפורים קצרים'
      : 'טון מקצועי ואמין, נתונים + ערך';

    // Load recent signals for content ideas
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    const [recentSignals, competitors, sectorKnowledge] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: sevenDaysAgo } },
        orderBy: { created_date: 'desc' },
        take: 5,
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        select: { name: true, strengths: true, weaknesses: true },
        take: 3,
      }),
      prisma.sectorKnowledge.findFirst({
        where: { sector: category },
        orderBy: { created_date: 'desc' },
      }),
    ]);

    // Check if we already created a calendar this week
    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const existingCalendar = await prisma.task.findFirst({
      where: {
        linked_business: businessProfileId,
        source_type: 'content_calendar',
        created_date: { gte: thisWeekStart },
      },
    });

    if (existingCalendar) {
      return res.json({ message: 'Content calendar already generated this week', tasks_created: 0 });
    }

    // Build context for the prompt
    const signalContext = recentSignals.length > 0
      ? `מגמות שוק השבוע:\n${recentSignals.map(s => `- ${s.summary}`).join('\n')}`
      : '';

    const competitorContext = competitors.length > 0
      ? `מתחרים:\n${competitors.map(c => `- ${c.name}${c.weaknesses ? ` (חולשה: ${c.weaknesses.substring(0, 50)})` : ''}`).join('\n')}`
      : '';

    const sectorContext = sectorKnowledge?.trending_services
      ? `שירותים מבוקשים בתחום: ${sectorKnowledge.trending_services}`
      : '';

    const todayDate = new Date();
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(todayDate);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });

    const sectorCtx = getSectorContext(category);

    // Generate the content calendar
    const descriptionLine = profile.description ? `תיאור העסק: ${profile.description}\n` : '';

    const calendarResult = await invokeLLM({
      prompt: `אתה מנהל תוכן דיגיטלי לעסקים ישראלים. צור לוח תוכן שבועי עבור "${name}" (${category} ב${city}).
${descriptionLine}${sectorCtx}

${signalContext}
${competitorContext}
${sectorContext}
${contentStyle ? `סגנון תוכן מועדף: ${contentStyle}` : ''}
ערוצים: ${preferredChannels}
סגנון: ${toneInstruction}

כללים:
1. כל פוסט עם וו פתיחה חזק (שאלה / סטטיסטיקה / טיפ מהיר)
2. גיוון: 2 חינוכיים, 2 מוצר/שירות, 1 עדות לקוח, 1 מאחורי הקלעים, 1 שאלה לקהל
3. הגבל כל פוסט ל-60-80 מילים
4. כלול 3-5 האשטאגים רלוונטיים
5. הצע זמן פרסום אופטימלי (07:00-09:00 / 12:00-14:00 / 18:00-21:00)

החזר JSON:
{
  "posts": [
    {
      "day_index": 0,
      "topic": "נושא הפוסט",
      "format": "תמונה|ריל|קרוסל|סטורי",
      "hook": "פתיחה מושכת",
      "body": "גוף הפוסט המלא בעברית",
      "hashtags": "#האשטאג1 #האשטאג2",
      "best_time": "18:00",
      "post_type": "חינוכי|מוצר|עדות|מאחורי_הקלעים|שאלה"
    }
  ]
}`,
      response_json_schema: { type: 'object' },
    });

    const posts: any[] = calendarResult?.posts || [];
    if (posts.length === 0) {
      await writeAutomationLog('contentCalendarAgent', businessProfileId, startTime, 0);
      return res.json({ tasks_created: 0, message: 'No posts generated' });
    }

    let tasksCreated = 0;

    for (const post of posts.slice(0, 7)) {
      try {
        const dayIndex = typeof post.day_index === 'number' ? post.day_index : 0;
        const dayName = DAYS_HE[dayIndex % 7] || DAYS_HE[0];
        const postDate = weekDates[dayIndex] || weekDates[0];
        const dueDate = `${postDate}T${post.best_time || '18:00'}:00.000Z`;

        const taskDescription = [
          `📌 נושא: ${post.topic}`,
          `🎯 פורמט: ${post.format || 'תמונה'} | שעת פרסום מומלצת: ${post.best_time || '18:00'}`,
          ``,
          `📝 טקסט הפוסט:`,
          `${post.hook || ''}`,
          `${post.body || ''}`,
          ``,
          `${post.hashtags || ''}`,
        ].join('\n');

        await prisma.task.create({
          data: {
            linked_business: businessProfileId,
            title: `[${dayName}] ${post.topic}`,
            description: taskDescription,
            status: 'pending',
            priority: 'medium',
            due_date: dueDate,
            source_type: 'content_calendar',
            notes: `סוג: ${post.post_type || 'כללי'} | ערוץ: ${preferredChannels.split(',')[0] || 'instagram'}`,
          },
        });

        tasksCreated++;
      } catch (_) {}
    }

    // Create a summary ProactiveAlert
    if (tasksCreated > 0) {
      const firstPost = posts[0];
      const actionMeta = JSON.stringify({
        action_label: 'פרסם ראשון',
        action_type: 'social_post',
        prefilled_text: `${firstPost?.hook || ''}\n\n${firstPost?.body || ''}\n\n${firstPost?.hashtags || ''}`.trim(),
        urgency_hours: 48,
        impact_reason: 'עקביות בפרסום מגדילה את ה-Reach האורגני ב-40% ומביאה לידים חדשים',
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: `לוח תוכן שבועי מוכן — ${tasksCreated} פוסטים`,
          description: `הוכן לוח תוכן מלא לשבוע זה עבור ${name}. הפוסטים נמצאים בדף המשימות.`,
          suggested_action: `פרסם את הפוסט הראשון של השבוע: ${posts[0]?.topic || ''}`,
          priority: 'medium',
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
    }

    await writeAutomationLog('contentCalendarAgent', businessProfileId, startTime, tasksCreated);
    console.log(`contentCalendarAgent done: ${tasksCreated} tasks created`);
    return res.json({ tasks_created: tasksCreated });
  } catch (err: any) {
    console.error('contentCalendarAgent error:', err.message);
    await writeAutomationLog('contentCalendarAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
