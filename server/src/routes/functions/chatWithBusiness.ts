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

    const systemContext = `You are a smart and experienced business advisor for the OTX Intelligence platform.
You are speaking with the **business owner** — not their customer.
ALL your responses must be written in Hebrew.

Business details:
• Name: ${profile.name}
• Sector: ${profile.category}
• City: ${profile.city}
• Services: ${profile.relevant_services || 'לא צוינו'}
${profile.description ? `• Description: ${profile.description}` : ''}
• Weekly score: ${weeklyScore}/10

Current market signals:
${signalLines}

Competitors:
${competitorLines}

Recent reviews:
${reviewLines}

Active leads:
${leadLines}

Conversation rules:
1. Always address the business owner in second person: "העסק שלך", "הלקוחות שלך", "אתה"
2. Give focused business recommendations — not generic internet information
3. Use the specific data above when relevant
4. If asked about a domain you have no data on — say so and offer to scan
5. Keep answers short — up to 3 sentences; longer only for complex questions
6. Always respond in Hebrew

Correct tone: "הלקוחות שלך מחפשים X — כדאי שתעשה Y"
Incorrect tone: "אנחנו שמחים לעזור" / "ניתן לשקול" / "מומלץ להתייעץ עם"`;


    const fullPrompt = `${systemContext}

Conversation history:
${history}

User message: ${message}`;

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
