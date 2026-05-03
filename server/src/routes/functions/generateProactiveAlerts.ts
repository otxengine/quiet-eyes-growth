import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';

export async function generateProactiveAlerts(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();

    const [recentReviews, hotLeads, signals, competitors, pendingAlerts] = await Promise.all([
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 10 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: 'hot' }, orderBy: { created_date: 'desc' }, take: 10 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 10 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 5 }),
      prisma.proactiveAlert.findMany({ where: { linked_business: businessProfileId, is_dismissed: false } }),
    ]);

    const existingTitles = new Set(pendingAlerts.map(a => a.title));

    const negativeReviews = recentReviews.filter(r => r.sentiment === 'negative' || (r.rating || 5) <= 2);
    const avgRating = recentReviews.length > 0
      ? (recentReviews.reduce((s, r) => s + (r.rating || 4), 0) / recentReviews.length).toFixed(1)
      : null;

    const contextBlock = [
      `עסק: ${profile.name} (${profile.category}, ${profile.city})`,
      profile.description ? `תיאור: ${profile.description}` : '',
      recentReviews.length > 0 ? `ביקורות אחרונות: ${recentReviews.length} ביקורות, ממוצע ${avgRating}, ${negativeReviews.length} שליליות` : 'ביקורות: אין עדיין — עסק חדש',
      hotLeads.length > 0 ? `לידים חמים: ${hotLeads.length} לידים ממתינים לטיפול` : 'לידים: אין עדיין',
      signals.length > 0 ? `תובנות שוק: ${signals.slice(0, 3).map(s => s.summary).join('; ')}` : '',
      competitors.length > 0 ? `מתחרים: ${competitors.map(c => `${c.name} (${c.rating || '?'}⭐)`).join(', ')}` : 'מתחרים: לא זוהו עדיין',
    ].filter(Boolean).join('\n');

    const todayDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

    const isNewBusiness = recentReviews.length === 0 && hotLeads.length === 0 && signals.length === 0;

    // Inject learned business context (tone, channels, rejected patterns)
    const bizCtx = await loadBusinessContext(businessProfileId);
    const ctxPrompt = formatContextForPrompt(bizCtx, 'generateProactiveAlerts');

    const result = await invokeLLM({
      prompt: `אתה מערכת ניטור פרואקטיבית לעסקים ישראלים. היום: ${todayDate}.
${ctxPrompt}
${contextBlock}

${isNewBusiness ? `זהו עסק חדש ללא נתוני לקוחות עדיין.
צור 2-3 המלצות ראשוניות ספציפיות לסקטור זה — פעולות שכל עסק חדש בסקטור זה צריך לעשות.
` : ''}

כללים קריטיים:
1. כל title חייב לכלול פעולה ספציפית, לא כותרת גנרית
2. כל suggested_action חייב להתחיל בפועל ציווי + ערוץ + תוכן ספציפי
3. action_label: מקסימום 4 מילים, מתחיל בפועל ("שלח תגובה", "פרסם פוסט", "צלצל ללקוח")
4. action_type: אחד מ post_publish / respond / call / task / promote
   השתמש ב-post_publish כאשר הפעולה היא פרסום פוסט ברשת חברתית (המערכת תפרסם ישירות)
5. action_platform: הפלטפורמה הכי מתאימה — instagram | facebook | tiktok | google | whatsapp | wolt | ten_bis | general
6. platform_reason: משפט אחד בעברית — מדוע פלטפורמה זו מתאימה לעסק ולהתראה זו
7. prefilled_text: טקסט מוכן (פוסט/תגובה/סקריפט שיחה) בעברית — 20-60 מילים, מותאם לטון העסק
8. urgency_hours: כמה שעות יש לפעול (1-48)
9. impact_reason: משפט אחד — מה יקרה אם לא יפעלו עכשיו

צור 2-4 התראות. החזר JSON:
{"alerts":[{
  "title": "כותרת ספציפית עם שם/מספר",
  "description": "הסבר מה קרה ולמה זה חשוב (עד 150 תווים)",
  "alert_type": "negative_review|hot_lead|competitor_move|market_opportunity|retention_risk",
  "priority": "high|medium|low",
  "suggested_action": "פעולה מפורטת ספציפית",
  "action_label": "פועל + עצם",
  "action_type": "post_publish|respond|call|task|promote",
  "action_platform": "instagram|facebook|tiktok|google|whatsapp|wolt|ten_bis|general",
  "platform_reason": "מדוע פלטפורמה זו — משפט אחד",
  "prefilled_text": "טקסט מוכן לשימוש ישיר...",
  "urgency_hours": 24,
  "impact_reason": "מה יקרה אם לא יפעלו עכשיו — משפט אחד"
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawAlerts: any[] = result?.alerts || [];

    // Memory suppression — filter alerts matching rejected patterns
    const rejectedPatterns: string[] = (bizCtx as any)?.rejected_patterns
      ? ((bizCtx as any).rejected_patterns as string).split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : [];

    const filteredAlerts = rawAlerts.filter(alert => {
      if (!alert.title) return false;
      const text = `${alert.title} ${alert.description || ''}`.toLowerCase();
      return !rejectedPatterns.some(p => p && text.includes(p));
    });

    // Insight clustering — group by alert_type, keep highest-priority per type
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const byType: Record<string, any[]> = {};
    for (const alert of filteredAlerts) {
      const t = alert.alert_type || 'general';
      if (!byType[t]) byType[t] = [];
      byType[t].push(alert);
    }
    const alerts = Object.values(byType).map(group => {
      if (group.length === 1) return group[0];
      group.sort((a: any, b: any) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));
      const best = { ...group[0] };
      if (group.length > 1) {
        best.description = `${best.description || ''} (כולל ${group.length - 1} תופעות דומות נוספות)`.trim();
      }
      return best;
    });

    let created = 0;

    for (const alert of alerts) {
      if (!alert.title || existingTitles.has(alert.title)) continue;

      // Store action metadata in source_agent as JSON (unified with MarketSignal format)
      const actionMeta = JSON.stringify({
        action_label:    alert.action_label || alert.suggested_action?.split(' ').slice(0, 3).join(' ') || 'פתח משימה',
        action_type:     alert.action_type || 'task',
        action_platform: alert.action_platform || '',
        platform_reason: alert.platform_reason || '',
        prefilled_text:  alert.prefilled_text || alert.prefilled_content || '',
        urgency_hours:   alert.urgency_hours || 24,
        impact_reason:   alert.impact_reason || '',
      });

      await prisma.proactiveAlert.create({
        data: {
          title: alert.title,
          description: alert.description || '',
          alert_type: alert.alert_type || 'general',
          priority: alert.priority || 'medium',
          suggested_action: alert.suggested_action || '',
          source_agent: actionMeta,  // repurposed field for action metadata
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
      existingTitles.add(alert.title);
      created++;
    }

    await writeAutomationLog('generateProactiveAlerts', businessProfileId, startTime, created);
    console.log(`generateProactiveAlerts done: ${created} alerts created`);
    return res.json({ alerts_created: created, items_created: created });
  } catch (err: any) {
    console.error('generateProactiveAlerts error:', err.message);
    await writeAutomationLog('generateProactiveAlerts', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
