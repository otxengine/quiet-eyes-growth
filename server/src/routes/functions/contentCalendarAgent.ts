import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { getSectorContentStrategy } from '../../lib/sectorPrompts';

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

    // Load rich intelligence for high-quality content
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    const [recentSignals, competitors, sectorKnowledge, audienceSignal, trendSignals, recentReviews] = await Promise.all([
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: sevenDaysAgo } },
        orderBy: { created_date: 'desc' },
        take: 8,
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        select: { name: true, strengths: true, weaknesses: true, category: true },
        take: 5,
      }),
      prisma.sectorKnowledge.findFirst({
        where: { sector: category },
        orderBy: { created_date: 'desc' },
      }),
      // TikTok audience intelligence
      prisma.marketSignal.findFirst({
        where: { linked_business: businessProfileId, category: 'tiktok_audience' },
        orderBy: { detected_at: 'desc' },
      }),
      // TikTok sector trends
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, category: 'tiktok_sector_trend' },
        orderBy: { detected_at: 'desc' },
        take: 3,
      }),
      // Recent positive reviews for social proof
      prisma.review.findMany({
        where: { linked_business: businessProfileId, sentiment: 'positive' },
        orderBy: { created_date: 'desc' },
        take: 3,
        select: { text: true, reviewer_name: true, rating: true },
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

    // Parse TikTok audience intelligence
    let audienceCtx = '';
    if (audienceSignal?.source_description) {
      try {
        const aud = JSON.parse(audienceSignal.source_description);
        const pa = aud.primary_audience;
        if (pa) {
          audienceCtx = `קהל יעד מאומת (מבוסס TikTok + מחקר):
• גיל: ${pa.age_range || '?'}, מגדר: ${pa.gender_skew || '?'}
• תחומי עניין: ${(pa.interests || []).join(', ')}
• מה מניע אותם לצרוך תוכן: ${pa.why_they_follow || '?'}
• כאבים עיקריים: ${(pa.pain_points || []).join(', ')}
• Hooks שעובדים: ${(aud.hooks_that_work || []).slice(0, 3).join(' | ')}
• שעות פרסום שיא: ${(aud.best_posting_hours_il || []).join(', ')}`;
        }
      } catch {}
    }

    // Build context blocks
    const signalContext = recentSignals.length > 0
      ? `מגמות שוק השבוע:\n${recentSignals.map(s => `- ${s.summary}`).join('\n')}`
      : '';

    const trendContext = trendSignals.length > 0
      ? `טרנדים ב-TikTok לסקטור:\n${trendSignals.map(s => `- ${s.summary}`).join('\n')}`
      : '';

    const competitorContext = competitors.length > 0
      ? `מתחרים — הזדמנויות הבדלה:\n${competitors.map(c =>
          `- ${c.name}${c.weaknesses ? ` | חולשה: ${c.weaknesses.substring(0, 60)}` : ''}`
        ).join('\n')}`
      : '';

    const socialProof = recentReviews.length > 0
      ? `ביקורות חיוביות לשימוש בפוסטים:\n${recentReviews.map(r =>
          `- "${(r.text || '').substring(0, 100)}" — ${r.reviewer_name || 'לקוח מרוצה'}`
        ).join('\n')}`
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

    const sectorStrategy = getSectorContentStrategy(category);

    // Generate the content calendar with Sonnet for high quality output
    const descriptionLine = profile.description ? `תיאור העסק: ${profile.description}\n` : '';

    const calendarResult = await invokeLLM({
      model: 'sonnet',
      maxTokens: 3000,
      skipCache: true,
      prompt: `אתה מנהל תוכן דיגיטלי בכיר לעסקים ישראלים. המשימה: לוח תוכן שבועי שהמשתמש יוכל לסמוך עליו ולפרסם ישירות — ללא עריכה.

העסק: "${name}" (${category}, ${city})
${descriptionLine}${sectorStrategy}

${audienceCtx ? `=== מחקר קהל יעד ===\n${audienceCtx}\n===` : ''}
${signalContext ? `\n${signalContext}` : ''}
${trendContext ? `\n${trendContext}` : ''}
${competitorContext ? `\n${competitorContext}` : ''}
${socialProof ? `\n${socialProof}` : ''}
${sectorContext ? `\n${sectorContext}` : ''}
${contentStyle ? `\nסגנון תוכן מועדף: ${contentStyle}` : ''}

ערוצים: ${preferredChannels}
טון: ${toneInstruction}

חוקי פוסט שחייבים לעבוד:
1. כל פוסט חייב להתחיל ב-Hook של שורה אחת מנצחת (שאלה חדה / עובדה מפתיעה / אמירה אמיצה)
2. גוף הפוסט: 80-130 מילים, ערך אמיתי, שפה חיה ואנושית — לא שיווקית
3. CTA ברור בסוף כל פוסט (שאל שאלה / הזמן / שלח הודעה / בקר)
4. האשטאגים: 3 רחבים (#קטגוריה) + 2 נישה ספציפיים לפוסט + 1 לוקאלי לעיר
5. פיזור עמודי תוכן: 2 חינוכיים, 1 מאחורי קלעים, 1 עדות/לקוח, 1 מוצר/שירות, 1 ויראלי/שאלה, 1 מוטיבציה/ערך
6. כל פוסט — פורמט מדויק: תמונה / ריל / קרוסל (3-5 שקפים) / סטורי
7. זמן פרסום מבוסס קהל יעד — לא גנרי
8. אם יש ביקורת חיובית ברשימה — שלב ציטוט אמיתי בפוסט העדות

החזר JSON בלבד:
{
  "posts": [
    {
      "day_index": 0,
      "day_name": "ראשון",
      "topic": "נושא ספציפי",
      "format": "ריל|קרוסל|תמונה|סטורי",
      "post_type": "חינוכי|מאחורי_קלעים|עדות|מוצר|ויראלי|מוטיבציה",
      "target_audience_angle": "זווית קהל יעד ספציפית לפוסט זה",
      "hook": "שורה ראשונה — Hook מנצח",
      "body": "גוף הפוסט המלא בעברית — 80-130 מילים עם ערך אמיתי",
      "cta": "קריאה לפעולה ספציפית",
      "hashtags": "#האשטאג1 #האשטאג2 #האשטאג3 #נישה1 #נישה2 #עיר",
      "best_time": "19:00",
      "carousel_slides": null,
      "visual_direction": "תיאור ויזואל מומלץ לפוסט"
    }
  ]
}

אם format=קרוסל, מלא carousel_slides: ["טקסט שקף 1 (כותרת)", "תוכן שקף 2", "תוכן שקף 3", "CTA שקף אחרון"]
`,
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
          `🎯 פורמט: ${post.format || 'תמונה'} | סוג: ${post.post_type || 'כללי'} | שעת פרסום: ${post.best_time || '18:00'}`,
          post.target_audience_angle ? `👥 זווית קהל: ${post.target_audience_angle}` : '',
          post.visual_direction ? `🖼 ויזואל: ${post.visual_direction}` : '',
          ``,
          `📝 טקסט הפוסט המלא:`,
          `${post.hook || ''}`,
          ``,
          `${post.body || ''}`,
          ``,
          `${post.cta ? `→ ${post.cta}` : ''}`,
          ``,
          `${post.hashtags || ''}`,
          post.carousel_slides?.length ? `\n📊 שקפי קרוסל:\n${post.carousel_slides.map((s: string, i: number) => `שקף ${i + 1}: ${s}`).join('\n')}` : '',
        ].filter(Boolean).join('\n');

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

        // Also create an OrganicPost draft with full content
        const postContent = [post.hook, post.body, post.cta ? `→ ${post.cta}` : '', post.hashtags].filter(Boolean).join('\n\n');
        const platform = preferredChannels.split(',')[0]?.trim() || 'instagram';
        await prisma.organicPost.create({
          data: {
            linked_business: businessProfileId,
            platform,
            post_type: post.format?.includes('ריל') ? 'reel' : 'post',
            content: postContent,
            signal_summary: `[${dayName}] ${post.topic} | ${post.post_type || 'כללי'} | ${post.best_time || '18:00'}`,
            status: 'draft',
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
