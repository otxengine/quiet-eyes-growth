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

    const [recentReviews, hotLeads, signals, competitors, pendingAlerts, audienceSignal, demandGaps, lostLeads] = await Promise.all([
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: 'hot' }, orderBy: { created_date: 'desc' }, take: 15 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { detected_at: 'desc' }, take: 20 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 8 }),
      prisma.proactiveAlert.findMany({ where: { linked_business: businessProfileId, is_dismissed: false } }),
      prisma.marketSignal.findFirst({ where: { linked_business: businessProfileId, category: 'tiktok_audience' }, orderBy: { detected_at: 'desc' } }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId, category: 'demand_gap' }, orderBy: { detected_at: 'desc' }, take: 5 }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId, status: { in: ['lost', 'cold'] } }, orderBy: { created_date: 'desc' }, take: 10 }),
    ]);

    const existingTitles = new Set(pendingAlerts.map(a => a.title));

    // Fuzzy dedup keys: normalize first 50 chars per alert_type within last 72h
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 3600000).toISOString();
    const recentAlerts = pendingAlerts.filter(a => (a.created_at || '') >= seventyTwoHoursAgo);
    const recentFuzzyKeys = new Set(
      recentAlerts.map(a => `${a.alert_type}:${(a.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`)
    );

    const negativeReviews = recentReviews.filter(r => r.sentiment === 'negative' || (r.rating || 5) <= 2);
    const avgRating = recentReviews.length > 0
      ? (recentReviews.reduce((s, r) => s + (r.rating || 4), 0) / recentReviews.length).toFixed(1)
      : null;

    // Parse TikTok audience for better persona targeting
    let audienceInfo = '';
    if (audienceSignal?.source_description) {
      try {
        const aud = JSON.parse(audienceSignal.source_description);
        const pa = aud.primary_audience;
        if (pa) {
          audienceInfo = `קהל יעד מאומת: גיל ${pa.age_range}, ${pa.gender_skew}. כאבים: ${(pa.pain_points || []).join(', ')}. Hooks: ${(aud.hooks_that_work || []).slice(0, 2).join(' | ')}`;
        }
      } catch {}
    }

    const contextBlock = [
      `עסק: ${profile.name} (${profile.category}, ${profile.city})`,
      profile.description ? `תיאור: ${profile.description}` : '',
      profile.relevant_services ? `שירותים: ${profile.relevant_services}` : '',
      recentReviews.length > 0
        ? `ביקורות: ${recentReviews.length} סה"כ | ממוצע ${avgRating}⭐ | ${negativeReviews.length} שליליות${negativeReviews[0]?.text ? ` | ביקורת שלילית אחרונה: "${negativeReviews[0].text.substring(0, 80)}"` : ''}`
        : 'ביקורות: אין עדיין',
      hotLeads.length > 0
        ? `לידים חמים (${hotLeads.length}): ${hotLeads.slice(0, 3).map(l => `${l.name || 'ליד'} — ${l.service_needed || 'שירות לא צוין'}`).join(', ')}`
        : 'לידים חמים: אין',
      lostLeads.length > 0
        ? `לידים שאבדו / קרים: ${lostLeads.length} | דוגמאות: ${lostLeads.slice(0, 3).map(l => l.name || 'לקוח').join(', ')}`
        : '',
      signals.length > 0
        ? `אותות שוק עדכניים:\n${signals.slice(0, 6).map(s => `  • [${s.category || 'שוק'}] ${s.summary}`).join('\n')}`
        : '',
      demandGaps.length > 0
        ? `פערי ביקוש שזוהו:\n${demandGaps.slice(0, 3).map(g => `  • ${g.summary}`).join('\n')}`
        : '',
      competitors.length > 0
        ? `מתחרים (${competitors.length}): ${competitors.slice(0, 5).map(c => `${c.name}(${c.rating || '?'}⭐)`).join(', ')}`
        : 'מתחרים: לא זוהו',
      audienceInfo ? `\nקהל יעד: ${audienceInfo}` : '',
    ].filter(Boolean).join('\n');

    const todayDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

    const isNewBusiness = recentReviews.length === 0 && hotLeads.length === 0 && signals.length === 0;

    // Inject learned business context (tone, channels, rejected patterns)
    const bizCtx = await loadBusinessContext(businessProfileId);
    const ctxPrompt = formatContextForPrompt(bizCtx, 'generateProactiveAlerts');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 2000,
      skipCache: true,
      prompt: `אתה מערכת ניטור פרואקטיבית בכירה לעסקים ישראלים קטנים. היום: ${todayDate}.
המשימה שלך: לזהות את ההזדמנויות והסיכונים הקונקרטיים ביותר מתוך הנתונים, ולהמליץ על פעולות שהמשתמש יכול לבצע תוך דקות.

${ctxPrompt}
=== נתוני העסק ===
${contextBlock}

${isNewBusiness ? `⚠️ עסק חדש: אין נתונים היסטוריים עדיין.
צור 2-3 המלצות ראשוניות CRITICAL לסקטור זה — מה שכל עסק חדש חייב לעשות בשבוע הראשון.
` : ''}

חוקי איכות בלתי ניתנים לפשרה:
1. TITLE: חייב לכלול שם ספציפי / מספר / פעולה — "ביקורת שלילית מ-X", "3 לידים חמים ממתינים", "מגמה ב-TikTok להנצל"
2. DESCRIPTION: עובדה קונקרטית מהנתונים — לא הכללה גנרית
3. SUGGESTED_ACTION: פועל ציווי + ערוץ + תוכן ("פרסם Reel ב-TikTok על X", "שלח WhatsApp אישי ל-Y", "הגב לביקורת של Z")
4. PREFILLED_TEXT: טקסט מוכן שהמשתמש יכול להעתיק ולשלוח ישירות — 40-80 מילים, בשם העסק, טון אנושי + מקצועי.
   עבור פוסטים: כולל Hook + גוף + CTA + האשטאגים רלוונטיים.
   עבור תגובות: כולל שם הלקוח, התייחסות לתוכן, פתרון.
   עבור WhatsApp: ידידותי, קצר, עם CTA ברור.
5. ACTION_TYPE: post_publish=פרסום ברשת חברתית (מייצר פוסט מלא) | respond=תגובה לביקורת/לקוח | call=שיחת טלפון | task=משימה פנימית | promote=קידום ממומן
6. PLATFORM: בחר לפי: instagram=תוכן ויזואלי 18-40 | tiktok=ויראלי 16-30 | facebook=מקומי 30+ | google=ביקורות/SEO | whatsapp=תקשורת ישירה | general=חוצה פלטפורמות
7. URGENCY_HOURS: זמן ריאלי — ביקורת שלילית=2h, ליד חם=4h, הזדמנות שוק=24h, תוכן=48h

צור 3-5 התראות מגוונות ולא כפולות. JSON בלבד:
{"alerts":[{
  "title": "כותרת ספציפית עם פרטים",
  "description": "הסבר ממוקד מה קרה ולמה זה חשוב עכשיו (עד 120 תווים)",
  "alert_type": "negative_review|hot_lead|competitor_move|market_opportunity|retention_risk|demand_gap|content_opportunity",
  "priority": "critical|high|medium|low",
  "suggested_action": "פעולה ספציפית מפורטת — ערוץ + תוכן + קהל",
  "action_label": "פועל + עצם (עד 4 מילים)",
  "action_type": "post_publish|respond|call|task|promote",
  "action_platform": "instagram|facebook|tiktok|google|whatsapp|wolt|ten_bis|general",
  "platform_reason": "מדוע פלטפורמה זו — משפט אחד עם נימוק",
  "prefilled_text": "טקסט מוכן שאפשר לשלוח/לפרסם ישירות בעברית — 40-80 מילים",
  "urgency_hours": 4,
  "impact_reason": "מה יקרה אם לא יפעלו עכשיו — נזק קונקרטי"
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
      // Fuzzy dedup: same alert_type + similar title within 72h
      const fuzzyKey = `${alert.alert_type}:${(alert.title as string).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)}`;
      if (recentFuzzyKeys.has(fuzzyKey)) continue;

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
      recentFuzzyKeys.add(fuzzyKey);
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
