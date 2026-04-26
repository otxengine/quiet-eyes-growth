import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * getAudienceSegments
 *
 * Analyzes reviews + leads + recent signals to produce 3 audience profiles.
 * Data-driven: if enough real data exists, the segments are grounded in evidence.
 *
 * Body: { businessProfileId, insight_text?, action_type? }
 * Returns: { segments: AudienceSegment[], data_quality: 'real' | 'estimated' }
 */
export async function getAudienceSegments(req: Request, res: Response) {
  const { businessProfileId, insight_text, action_type } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const [profile, reviews, leads, signals] = await Promise.all([
      prisma.businessProfile.findUnique({ where: { id: businessProfileId } }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 40,
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 30,
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { detected_at: 'desc' },
        take: 20,
      }),
    ]);

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const hasRealData = reviews.length >= 3 || leads.length >= 3;
    const dataQuality = hasRealData ? 'real' : 'estimated';

    // Build grounded data context
    const positiveReviews = reviews.filter(r => r.sentiment === 'positive' || (r.rating || 0) >= 4);
    const negativeReviews = reviews.filter(r => r.sentiment === 'negative' || (r.rating || 0) <= 2);

    const reviewSamples = reviews
      .slice(0, 15)
      .map(r => `[${r.sentiment || 'neutral'}/${r.rating || '?'}⭐] "${(r.text || '').slice(0, 100)}"`)
      .join('\n');

    const leadSamples = leads
      .slice(0, 12)
      .map(l => `"${(l.service_needed || l.name || '').slice(0, 80)}" (${l.source || 'unknown'}, סטטוס: ${l.status || '?'})`)
      .join('\n');

    const signalSamples = signals
      .slice(0, 8)
      .map(s => s.summary)
      .join(', ');

    // Conversion rate stats
    const completedLeads = leads.filter(l => l.status === 'completed').length;
    const lostLeads      = leads.filter(l => l.status === 'lost').length;
    const conversionRate = leads.length > 0
      ? Math.round((completedLeads / leads.length) * 100)
      : 0;

    const insightContext = insight_text
      ? `\n\nתובנה שמצריכה קמפיין: "${insight_text}"${action_type ? ` (סוג: ${action_type})` : ''}`
      : '';

    const result = await invokeLLM({
      // sonnet (4096 tokens) — haiku's 512 limit truncates 3 full segment objects
      prompt: `אתה מומחה פילוח קהלים לעסקים ישראליים. בנה פרופילים מבוססי נתונים אמיתיים.

עסק: "${profile.name}" — ${profile.category} ב${profile.city}
שירותים: ${profile.relevant_services || 'לא צוינו'}
שוק יעד: ${profile.target_market || 'לא צוין'}
${profile.description ? `תיאור: ${profile.description}` : ''}${insightContext}

נתונים (${hasRealData ? 'אמיתיים' : 'מוגבלים'}):
- ${reviews.length} ביקורות (${positiveReviews.length} חיוביות, ${negativeReviews.length} שליליות)
- ${leads.length} לידים | המרה: ${conversionRate}% (${completedLeads} הושלמו, ${lostLeads} אבדו)
- סיגנלים: ${signalSamples || 'אין'}

ביקורות לדוגמה:
${reviewSamples || 'אין ביקורות עדיין'}

לידים לדוגמה:
${leadSamples || 'אין לידים עדיין'}

בנה 3 פרופילי קהל יעד ספציפיים לנתונים — לא כלליים. JSON בלבד:
{
  "segments": [
    {
      "segment_name": "שם קצר ותיאורי (עד 4 מילים)",
      "age_range": "XX-XX",
      "description": "תיאור הקהל — עד 15 מילה",
      "income_level": "low|mid|high",
      "interests": ["עניין 1", "עניין 2"],
      "pain_points": ["כאב עיקרי 1", "כאב עיקרי 2"],
      "purchase_triggers": ["מה גורם לרכישה"],
      "preferred_channels": ["Instagram", "WhatsApp", "Facebook"],
      "estimated_size": "small|medium|large",
      "conversion_probability": 0.0,
      "best_time_to_reach": "שעה/יום מומלץ",
      "targeting_keywords": ["מילת מפתח לפרסום"]
    }
  ]
}
חוק: כל פרופיל חייב להיות שונה מהאחרים ומבוסס על הנתונים שניתנו.`,
      response_json_schema: { type: 'object' },
    });

    const segments = Array.isArray(result?.segments) ? result.segments : [];
    return res.json({ segments, data_quality: dataQuality });
  } catch (err: any) {
    console.error('[getAudienceSegments] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
