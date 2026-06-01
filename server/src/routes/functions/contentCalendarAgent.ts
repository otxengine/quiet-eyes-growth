import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { getSectorContentStrategy } from '../../lib/sectorPrompts';
import { getAgentMission, getAllMissions } from '../../lib/missionPlanner';

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

    // Mission intelligence: per-agent calendar plan + content templates
    const calendarMission = getAgentMission<{
      best_platforms?: string[];
      posting_frequency_he?: string;
      content_pillars_he?: string[];
      seasonal_opportunities_he?: string[];
    }>(profile, 'contentCalendarAgent');
    const allMissions = getAllMissions(profile);
    const contentMissions = allMissions?.content;

    // Override preferred channels from mission if available
    const missionPlatforms = calendarMission?.best_platforms?.join(',') || '';
    const activePlatforms = missionPlatforms || preferredChannels;

    // Build mission blocks for prompt injection
    const contentPillarsBlock = calendarMission?.content_pillars_he?.length
      ? `נושאי תוכן מרכזיים לסקטור זה:\n${calendarMission.content_pillars_he.map(p => `• ${p}`).join('\n')}`
      : '';
    const seasonalBlock = calendarMission?.seasonal_opportunities_he?.length
      ? `הזדמנויות עונתיות קרובות:\n${calendarMission.seasonal_opportunities_he.map(s => `• ${s}`).join('\n')}`
      : '';
    const hookExamples = contentMissions?.post_hooks_he?.slice(0, 3).join('\n• ') || '';
    const hashtagGuide = contentMissions?.hashtags
      ? `hashtags מומלצים לסקטור:\nראשיים: ${(contentMissions.hashtags.primary || []).join(' ')} | מקומיים: ${(contentMissions.hashtags.local || []).join(' ')} | טרנדיים: ${(contentMissions.hashtags.trending || []).join(' ')}`
      : '';

    // Load rich intelligence for high-quality content
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    const [recentSignals, competitors, sectorKnowledge, audienceSignal, trendSignals, recentReviews, recentPosts] = await Promise.all([
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
      // Recent organic posts to avoid repeating topics
      prisma.organicPost.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(Date.now() - 14 * 86400000) } },
        orderBy: { created_date: 'desc' },
        take: 10,
        select: { content: true, post_type: true, signal_summary: true },
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

    // Gap analysis: which post types haven't been used recently
    const recentPostTypes = new Set(recentPosts.map(p => p.post_type).filter(Boolean));
    const allPostTypes = ['חינוכי', 'מאחורי_קלעים', 'עדות', 'מוצר', 'ויראלי', 'מוטיבציה'];
    const missingTypes = allPostTypes.filter(t => !recentPostTypes.has(t));
    const gapContext = missingTypes.length > 0
      ? `סוגי תוכן שלא פורסמו בשבועיים האחרונים (יש לכלול בלוח): ${missingTypes.join(', ')}`
      : '';

    // Recent topics to avoid repeating
    const recentTopics = recentPosts
      .slice(0, 7)
      .map(p => (p.signal_summary || p.content || '').slice(0, 60))
      .filter(Boolean);
    const avoidTopics = recentTopics.length > 0
      ? `נושאים שפורסמו לאחרונה — אל תחזור עליהם:\n${recentTopics.map(t => `- ${t}`).join('\n')}`
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
      profile,
      prompt: `You are a senior digital content manager for Israeli businesses. Your task: produce a weekly content calendar the user can publish directly — without any editing.
Return ONLY valid JSON. ALL string values must be in Hebrew.

Business: "${name}" (${category}, ${city})
${descriptionLine}${sectorStrategy}

${contentPillarsBlock ? `\n${contentPillarsBlock}` : ''}
${seasonalBlock ? `\n${seasonalBlock}` : ''}
${hookExamples ? `\nדוגמאות לפתיחת פוסט שעובדות בסקטור זה (השתמש כהשראה, לא כהעתקה):\n• ${hookExamples}` : ''}
${hashtagGuide ? `\n${hashtagGuide}` : ''}

${audienceCtx ? `=== מחקר קהל יעד ===\n${audienceCtx}\n===` : ''}
${signalContext ? `\n${signalContext}` : ''}
${trendContext ? `\n${trendContext}` : ''}
${competitorContext ? `\n${competitorContext}` : ''}
${socialProof ? `\n${socialProof}` : ''}
${sectorContext ? `\n${sectorContext}` : ''}
${contentStyle ? `\nסגנון תוכן מועדף: ${contentStyle}` : ''}
${gapContext ? `\n${gapContext}` : ''}
${avoidTopics ? `\n${avoidTopics}` : ''}

Channels: ${activePlatforms}
Tone: ${toneInstruction}
${calendarMission?.posting_frequency_he ? `Posting frequency for this sector: ${calendarMission.posting_frequency_he}` : ''}

Post rules that must be followed:
1. Every post must open with a single winning Hook line (sharp question / surprising fact / bold statement)
2. Post body: 80-130 words, real value, lively and human language — not marketing-speak
3. Clear CTA at the end of every post (ask a question / invite / send a message / visit)
4. Hashtags: 3 broad (#category) + 2 niche specific to the post + 1 local to the city
5. Content pillar distribution: 2 educational, 1 behind-the-scenes, 1 testimonial/customer, 1 product/service, 1 viral/question, 1 motivation/value
6. Every post — exact format: תמונה / ריל / קרוסל (3-5 slides) / סטורי
7. Publishing time based on target audience — not generic
8. If a positive review appears in the list — embed a real quote in the testimonial post

Return ONLY valid JSON. ALL string values must be in Hebrew:
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

If format=קרוסל, fill carousel_slides: ["טקסט שקף 1 (כותרת)", "תוכן שקף 2", "תוכן שקף 3", "CTA שקף אחרון"]
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
            notes: `סוג: ${post.post_type || 'כללי'} | ערוץ: ${activePlatforms.split(',')[0] || 'instagram'}`,
          },
        });

        // Also create an OrganicPost draft with full content
        const postContent = [post.hook, post.body, post.cta ? `→ ${post.cta}` : '', post.hashtags].filter(Boolean).join('\n\n');
        const platform = activePlatforms.split(',')[0]?.trim() || 'instagram';
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
