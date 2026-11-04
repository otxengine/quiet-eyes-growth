import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { loadBusinessContext } from '../../lib/businessContext';

/**
 * chatWithBusiness — context-aware AI assistant for a specific business.
 *
 * Fetches real data (signals, competitors, reviews, leads, sector knowledge) and builds
 * a rich system prompt so the assistant actually knows about this business.
 *
 * Body: { businessProfileId, message, history? }
 *   history: string (legacy) | Array<{ role: 'user'|'ai', text: string }> (multi-turn)
 * Returns: { reply: string, pendingAction?: object }
 */
export async function chatWithBusiness(req: Request, res: Response) {
  const { businessProfileId, message, history = '' } = req.body;
  if (!businessProfileId || !message) {
    return res.status(400).json({ error: 'Missing businessProfileId or message' });
  }

  try {
    // Fetch business data in parallel — rich context for smarter responses
    const [profile, recentSignals, competitors, recentReviews, recentLeads, pendingAlerts, bizMemory, healthScoreRow, sectorKnowledge] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 8,
        select: { summary: true, impact_level: true, category: true, recommended_action: true, detected_at: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 5,
        select: { name: true, strengths: true, weaknesses: true, rating: true, trend_direction: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 8,
        select: { text: true, rating: true, sentiment: true, response_status: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 10,
        select: { name: true, status: true, service_needed: true, score: true, source: true },
      }),
      prisma.proactiveAlert.findMany({
        where: { linked_business: businessProfileId, is_dismissed: false, is_acted_on: false },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: { title: true, alert_type: true, priority: true, suggested_action: true },
      }),
      prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } }),
      prisma.healthScore.findFirst({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' } }).catch(() => null),
      // NEW: cross-business sector patterns
      prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { category: true } })
        .then(bp => bp?.category
          ? (prisma as any).sectorKnowledge.findFirst({ where: { sector: bp.category } }).catch(() => null)
          : null
        ).catch(() => null),
    ]);

    if (!profile) {
      return res.status(404).json({ error: 'Business profile not found' });
    }

    // Load learned business preferences (tone, rejected patterns)
    const bizCtx = await loadBusinessContext(businessProfileId).catch(() => null);
    const preferredTone = (bizCtx as any)?.preferredTone || (profile as any)?.tone_preference || 'professional';

    // Build context blocks
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekSignalCount = recentSignals.filter(s => (s.detected_at || '') >= weekAgo).length;

    const highImpactSignals = recentSignals.filter(s => s.impact_level === 'high' || s.impact_level === 'critical');
    const signalLines = recentSignals.length > 0
      ? recentSignals.slice(0, 6).map(s => `• [${s.impact_level}/${s.category}] ${s.summary}${s.recommended_action ? ` → ${s.recommended_action.slice(0, 50)}` : ''}`).join('\n')
      : 'אין תובנות עדיין.';

    const competitorLines = competitors.length > 0
      ? competitors.map(c => `• ${c.name} (${c.rating || '?'}⭐${c.trend_direction === 'up' ? ' ↑מגמה עולה' : c.trend_direction === 'down' ? ' ↓יורד' : ''})`).join('\n')
      : 'אין מתחרים מזוהים עדיין.';

    const avgRating = recentReviews.length > 0
      ? (recentReviews.reduce((s, r) => s + (r.rating || 0), 0) / recentReviews.length).toFixed(1)
      : null;
    const pendingReviewCount = recentReviews.filter(r => r.response_status === 'pending').length;
    const negativeReviewCount = recentReviews.filter(r => r.sentiment === 'negative').length;

    const reviewLines = recentReviews.length > 0
      ? [
          `סה"כ: ${recentReviews.length} ביקורות | ממוצע: ${avgRating}⭐ | ${pendingReviewCount} ממתינות לתגובה | ${negativeReviewCount} שליליות`,
          ...recentReviews.filter(r => r.sentiment === 'negative').slice(0, 2).map(r =>
            `  ⚠ "${(r.text || '').slice(0, 80)}" (${r.rating}⭐)`
          ),
        ].filter(Boolean).join('\n')
      : 'אין ביקורות עדיין.';

    const hotLeads = recentLeads.filter(l => l.status === 'hot');
    const leadLines = recentLeads.length > 0
      ? [
          `סה"כ: ${recentLeads.length} לידים | ${hotLeads.length} חמים`,
          ...hotLeads.slice(0, 3).map(l => `  🔥 ${l.name || 'ליד'} — ${l.service_needed || ''} (ציון: ${l.score || '?'})`),
          ...recentLeads.filter(l => l.status === 'new').slice(0, 2).map(l =>
            `  🆕 ${l.name || 'ליד'} — ${l.service_needed || ''} מ-${l.source || 'לא ידוע'}`
          ),
        ].filter(Boolean).join('\n')
      : 'אין לידים כרגע.';

    const alertLines = pendingAlerts.length > 0
      ? pendingAlerts.map(a => `• [${a.priority}] ${a.title}`).join('\n')
      : null;

    const healthScoreVal = (healthScoreRow as any)?.overall_score || null;

    // Sector knowledge context
    let sectorKnowledgeLines = '';
    if (sectorKnowledge) {
      try {
        const dna = JSON.parse((sectorKnowledge as any).winner_lead_dna || '{}');
        const trending = (sectorKnowledge as any).trending_services || '';
        sectorKnowledgeLines = [
          trending ? `מגמות נפוצות בסקטור: ${trending}` : '',
          dna.winning_patterns ? `דפוסי ליד מנצחים: ${dna.winning_patterns}` : '',
          dna.key_insights ? `תובנות מרכזיות: ${dna.key_insights}` : '',
        ].filter(Boolean).join('\n');
      } catch {}
    }

    // Agent missions context (enriched)
    let agentMissionsLines = '';
    try {
      const missions = JSON.parse((profile as any).agent_missions || '{}');
      agentMissionsLines = [
        missions.quick_wins_he?.length   ? `ניצחונות מהירים:\n${missions.quick_wins_he.slice(0, 3).map((w: string) => `• ${w}`).join('\n')}` : '',
        missions.weekly_focus_he         ? `מוקד שבועי: ${missions.weekly_focus_he}` : '',
        missions.market_watch_he         ? `לעקוב בשוק: ${missions.market_watch_he}` : '',
        missions.competitor_watch_he     ? `לעקוב אצל מתחרים: ${missions.competitor_watch_he}` : '',
        missions.business_summary        ? `תקציר עסקי (AI): ${missions.business_summary}` : '',
      ].filter(Boolean).join('\n');
    } catch {}

    // Business deep profile (scraped website + social intelligence)
    let deepProfileLines = '';
    try {
      const dp = JSON.parse((profile as any).business_deep_profile || '{}');
      deepProfileLines = [
        dp.actual_services?.length          ? `שירותים מאומתים מהאתר: ${dp.actual_services.join(', ')}` : '',
        dp.unique_selling_points?.length    ? `יתרונות ייחודיים (USPs): ${dp.unique_selling_points.join(' | ')}` : '',
        dp.target_audience_detected         ? `קהל יעד מזוהה: ${dp.target_audience_detected}` : '',
        dp.tone_from_website                ? `טון מותג: ${dp.tone_from_website}` : '',
        dp.sector_specific_insights?.length ? `תובנות סקטור:\n${dp.sector_specific_insights.slice(0, 3).map((i: string) => `• ${i}`).join('\n')}` : '',
        dp.brand_keywords?.length           ? `מילות מפתח: ${dp.brand_keywords.join(', ')}` : '',
      ].filter(Boolean).join('\n');
    } catch {}

    const sectorProfile = (profile as any).sector_profile || '';

    const systemContext = `You are OTX — a sharp, data-driven business intelligence advisor for the OTX platform.
You are talking with **the business owner** — never with their customers.
ALL responses must be in Hebrew.

=== פרופיל עסק ===
• שם: ${profile!.name}
• סקטור: ${profile!.category} | עיר: ${profile!.city}
• שירותים: ${(profile as any).relevant_services || 'לא צוינו'}
${(profile as any).description ? `• תיאור: ${(profile as any).description}` : ''}
${healthScoreVal ? `• ציון בריאות עסקית: ${healthScoreVal}/100` : ''}
${preferredTone !== 'professional' ? `• סגנון תקשורת מועדף: ${preferredTone}` : ''}
${sectorProfile ? `• פרופיל סקטור: ${sectorProfile}` : ''}
${deepProfileLines ? `\n=== פרופיל עסקי עמוק (AI — מאתר ורשתות חברתיות) ===\n${deepProfileLines}` : ''}

=== תובנות שוק (${weekSignalCount} השבוע, ${highImpactSignals.length} השפעה גבוהה) ===
${signalLines}

=== מתחרים (${competitors.length}) ===
${competitorLines}

=== ביקורות ===
${reviewLines}

=== לידים ===
${leadLines}

${alertLines ? `=== התראות פעילות ===\n${alertLines}\n` : ''}${sectorKnowledgeLines ? `=== תובנות סקטור (למידה חוצת-עסקים) ===\n${sectorKnowledgeLines}\n` : ''}${agentMissionsLines ? `=== תכנית משימות AI (נוצרה בהרשמה) ===\n${agentMissionsLines}\n` : ''}=== כללי תגובה ===
1. פנה לבעל העסק בגוף שני: "העסק שלך", "אתה", "הלקוחות שלך"
2. השתמש בנתונים הספציפיים לעיל — לא עצות גנריות
3. תן תשובה מפורטת ככל שנדרש. לשאלות פשוטות — 2-3 משפטים. לניתוח או בקשת תוכן — השלם את המשימה במלואה.
   תמיכה ב-Markdown: השתמש ב-**מודגש**, רשימות (•), וכותרות (##) לתשובות ארוכות
4. אם אין נתונים לתחום שנשאל — אמור זאת והצע לסרוק
5. בסוף כל תגובה הצע פעולה קונקרטית אחת ב-pendingAction
6. תגובה בעברית בלבד

סגנון נכון: "הלקוחות שלך מחפשים X — שלח WhatsApp ל-Y עכשיו"
סגנון שגוי: "ניתן לשקול" / "מומלץ להתייעץ" / "אנחנו שמחים לעזור"

=== פורמט תשובה — JSON בלבד ===
{
  "reply": "תשובה בעברית",
  "pendingAction": {
    "type": "create_task|update_lead|respond_review|dismiss_alert|publish_post|generate_report|create_campaign|schedule_meeting|analyze_competitor",
    "label": "תיאור קצר בעברית",
    "payload": {}
  }
}

מתי להחזיר pendingAction:
- המלצה על פנייה ללידים חמים → create_task { title:"פנה ל-[שם]", description:"..." }
- בקשת יצירת משימה → create_task { title, description }
- המלצה לענות לביקורת → respond_review { suggested_response:"..." }
- פרסום תוכן → publish_post { platform:"facebook|instagram|google", text:"..." }
- דוח ניתוח → generate_report { reportType:"leads|reviews|competitors|weekly" }
- קמפיין שיווקי → create_campaign { channel:"whatsapp|email|social", goal:"..." }
- אם אין פעולה ברורה — השמט את pendingAction לגמרי`;

    // Convert history to safe string — supports both legacy string and new array format
    let safeHistory = '';
    if (typeof history === 'string') {
      safeHistory = history.replace(/<[^>]{0,200}>/g, '').slice(0, 2000);
    } else if (Array.isArray(history)) {
      safeHistory = (history as Array<{ role: string; text: string }>)
        .slice(-8) // last 8 messages max
        .map(m => `${m.role === 'ai' ? 'Assistant' : 'User'}: ${(m.text || '').slice(0, 500)}`)
        .join('\n');
    }

    const userTurn = `${safeHistory ? `Conversation history:\n${safeHistory}\n\n` : ''}User message: ${message.slice(0, 1000)}`;

    const raw = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1500,
      skipCache: true,
      prompt: userTurn,
      systemPrompt: systemContext,
      usePromptCache: true,
      response_json_schema: {
        type: 'object',
        properties: {
          reply: { type: 'string' },
          pendingAction: { type: 'object' },
        },
        required: ['reply'],
      },
    });

    let parsed: any = {};
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { parsed = { reply: raw }; }
    } else {
      parsed = raw || {};
    }

    return res.json({
      reply: parsed.reply || (typeof raw === 'string' ? raw : 'שגיאה בעיבוד התגובה'),
      pendingAction: parsed.pendingAction || null,
    });
  } catch (err: any) {
    console.error('[chatWithBusiness] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
