import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { loadBusinessContext } from '../../lib/businessContext';

/**
 * chatWithBusiness — context-aware AI assistant for a specific business.
 *
 * Fetches real data (signals, competitors, reviews, leads) and builds
 * a rich system prompt so the assistant actually knows about this business.
 *
 * Body: { businessProfileId, message, history? }
 * Returns: { reply: string }
 */
export async function chatWithBusiness(req: Request, res: Response) {
  const { businessProfileId, message, history = '' } = req.body;
  if (!businessProfileId || !message) {
    return res.status(400).json({ error: 'Missing businessProfileId or message' });
  }

  try {
    // Fetch business data in parallel — rich context for smarter responses
    const [profile, recentSignals, competitors, recentReviews, recentLeads, pendingAlerts, bizMemory, healthScoreRow] = await Promise.all([
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

=== תובנות שוק (${weekSignalCount} השבוע, ${highImpactSignals.length} השפעה גבוהה) ===
${signalLines}

=== מתחרים (${competitors.length}) ===
${competitorLines}

=== ביקורות ===
${reviewLines}

=== לידים ===
${leadLines}

${alertLines ? `=== התראות פעילות ===\n${alertLines}\n` : ''}
=== כללי תגובה ===
1. פנה לבעל העסק בגוף שני: "העסק שלך", "אתה", "הלקוחות שלך"
2. השתמש בנתונים הספציפיים לעיל — לא עצות גנריות
3. תשובות: עד 3 משפטים — קצר וישיר; מפורט רק לשאלות טכניות
4. אם אין נתונים לתחום שנשאל — אמור זאת והצע לסרוק
5. הצע פעולה אחת קונקרטית בסוף כל תגובה
6. תגובה בעברית בלבד

סגנון נכון: "הלקוחות שלך מחפשים X — שלח WhatsApp ל-Y עכשיו"
סגנון שגוי: "ניתן לשקול" / "מומלץ להתייעץ" / "אנחנו שמחים לעזור"`;


    const safeHistory = (typeof history === 'string' ? history : '').replace(/<[^>]{0,200}>/g, '').slice(0, 2000);

    const fullPrompt = `${systemContext}

Conversation history:
${safeHistory}

User message: ${message.slice(0, 1000)}`;

    const reply = await invokeLLM({
      model: 'sonnet',
      maxTokens: 350,
      skipCache: true,
      prompt: fullPrompt,
    });

    const replyText = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return res.json({ reply: replyText });
  } catch (err: any) {
    console.error('[chatWithBusiness] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
