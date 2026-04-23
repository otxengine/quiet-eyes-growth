import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

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
    // Fetch business data in parallel — keep queries light
    const [profile, recentSignals, competitors, recentReviews, recentLeads] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 5,
        select: { summary: true, impact_level: true, category: true, recommended_action: true },
      }),
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 5,
        select: { name: true, strengths: true, weaknesses: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 5,
        select: { text: true, rating: true, sentiment: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: { in: ['hot', 'new'] } },
        orderBy: { created_date: 'desc' },
        take: 5,
        select: { name: true, status: true, service_needed: true },
      }),
    ]);

    if (!profile) {
      return res.status(404).json({ error: 'Business profile not found' });
    }

    // Build context blocks
    const signalLines = recentSignals.length > 0
      ? recentSignals.map(s => `• [${s.impact_level}] ${s.summary}: ${(s.recommended_action || '').slice(0, 60)}`).join('\n')
      : 'אין תובנות עדיין.';

    const competitorLines = competitors.length > 0
      ? competitors.map(c => `• ${c.name}`).join('\n')
      : 'אין מתחרים מזוהים עדיין.';

    const reviewLines = recentReviews.length > 0
      ? recentReviews.map(r => `• [${r.sentiment || '?'} ${r.rating || '?'}⭐] "${(r.text || '').slice(0, 80)}"`).join('\n')
      : 'אין ביקורות עדיין.';

    const leadLines = recentLeads.length > 0
      ? recentLeads.map(l => `• ${l.name || 'ליד'} — ${l.service_needed || ''} (${l.status})`).join('\n')
      : 'אין לידים פעילים כרגע.';

    // Compute a simple weekly score proxy
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekSignalCount = recentSignals.filter(s => (s as any).detected_at >= weekAgo).length;
    const weeklyScore = Math.min(10, Math.max(1, Math.round(
      (recentSignals.length > 0 ? 4 : 0) +
      (recentLeads.length > 0 ? 3 : 0) +
      (recentReviews.length > 0 ? 2 : 0) +
      (weekSignalCount > 2 ? 1 : 0)
    )));

    const systemContext = `אתה יועץ עסקי חכם ומנוסה של מערכת OTX Intelligence.
אתה מדבר עם **בעל העסק** — לא עם לקוח שלו.

פרטי העסק שלך:
• שם: ${profile.name}
• סקטור: ${profile.category}
• עיר: ${profile.city}
• שירותים: ${profile.relevant_services || 'לא צוינו'}
• ציון שבועי: ${weeklyScore}/10

מה קורה עכשיו בשוק שלך:
${signalLines}

מתחרים שלך:
${competitorLines}

ביקורות אחרונות על העסק שלך:
${reviewLines}

לידים פעילים שלך:
${leadLines}

כללי שיחה:
1. דבר תמיד עם בעל העסק בגוף שני: "העסק שלך", "הלקוחות שלך", "אתה"
2. תן המלצות עסקיות ממוקדות — לא מידע כללי מהאינטרנט
3. השתמש בנתונים הספציפיים למעלה כשרלוונטי
4. אם שואלים על תחום שאין לך מידע — אמור זאת ותציע לסרוק
5. תשובות קצרות — עד 3 משפטים, ארוכות יותר רק לשאלות מורכבות
6. ענה בעברית תמיד

טון נכון: "הלקוחות שלך מחפשים X — כדאי שתעשה Y"
טון שגוי: "אנחנו שמחים לעזור" / "ניתן לשקול" / "מומלץ להתייעץ עם"`;


    const fullPrompt = `${systemContext}

היסטוריית השיחה:
${history}

שאלת המשתמש: ${message}`;

    const reply = await invokeLLM({
      model: 'haiku',
      prompt: fullPrompt,
    });

    const replyText = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return res.json({ reply: replyText });
  } catch (err: any) {
    console.error('[chatWithBusiness] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
