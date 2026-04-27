import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * getAudienceSegments
 *
 * Produces 3 audience profiles in proper paid-advertising format
 * (Facebook/Instagram targeting + Google Ads targeting),
 * grounded in the business's real reviews and leads data.
 *
 * Body: { businessProfileId, insight_text?, action_type? }
 * Returns: { segments, data_quality }
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

    const positiveReviews = reviews.filter(r => r.sentiment === 'positive' || (r.rating || 0) >= 4);
    const negativeReviews = reviews.filter(r => r.sentiment === 'negative' || (r.rating || 0) <= 2);

    const reviewSamples = reviews
      .slice(0, 15)
      .map(r => `[${r.sentiment || 'neutral'}/${r.rating || '?'}⭐] "${(r.text || '').slice(0, 100)}"`)
      .join('\n');

    const leadSamples = leads
      .slice(0, 12)
      .map(l => `"${(l.service_needed || l.name || '').slice(0, 80)}" (${l.source || 'unknown'})`)
      .join('\n');

    const completedLeads  = leads.filter(l => l.status === 'completed').length;
    const conversionRate  = leads.length > 0 ? Math.round((completedLeads / leads.length) * 100) : 0;
    const signalSamples   = signals.slice(0, 8).map(s => s.summary).join(', ');
    const insightContext  = insight_text
      ? `\n\nתובנה רלוונטית: "${insight_text}"${action_type ? ` (סוג: ${action_type})` : ''}`
      : '';

    const result = await invokeLLM({
      prompt: `אתה מומחה פרסום ממומן לעסקים ישראלים. בנה 3 קהלי יעד מדויקים לפורמט Facebook Ads ו-Google Ads.

עסק: "${profile.name}" — ${profile.category} ב${profile.city}
שירותים: ${profile.relevant_services || 'לא צוינו'}
שוק יעד: ${profile.target_market || 'לא צוין'}
${profile.description ? `תיאור: ${profile.description}` : ''}${insightContext}

נתונים (${hasRealData ? 'אמיתיים' : 'מוגבלים'}):
- ${reviews.length} ביקורות (${positiveReviews.length} חיוביות, ${negativeReviews.length} שליליות)
- ${leads.length} לידים | המרה: ${conversionRate}%
- סיגנלים: ${signalSamples || 'אין'}

ביקורות:
${reviewSamples || 'אין ביקורות עדיין'}

לידים:
${leadSamples || 'אין לידים עדיין'}

בנה 3 קהלי יעד שונים — כל אחד עם טרגטינג מוכן להדבקה בפלטפורמות הפרסום. JSON בלבד:
{
  "segments": [
    {
      "segment_name": "שם קצר ותיאורי (עד 4 מילים)",
      "description": "תיאור הקהל — עד 15 מילה",
      "age_min": 24,
      "age_max": 45,
      "genders": "נשים וגברים|נשים בלבד|גברים בלבד",
      "income_level": "low|mid|high",
      "conversion_probability": 0.35,
      "estimated_size": "small|medium|large",
      "estimated_audience_range": "15,000–55,000",
      "facebook_targeting": {
        "interests": ["שם עניין ב-Facebook 1","עניין 2","עניין 3","עניין 4"],
        "behaviors": ["התנהגות Facebook 1","התנהגות 2"],
        "custom_audience": "תיאור Custom Audience מומלץ",
        "lookalike_source": "מה להשתמש כ-seed ל-Lookalike",
        "exclusions": ["מה לא לכלול בטרגטינג"]
      },
      "google_targeting": {
        "keywords": ["ביטוי חיפוש 1","ביטוי 2","ביטוי 3"],
        "negative_keywords": ["מילת שלילה 1"],
        "in_market_audiences": ["קהל in-market 1","קהל 2"],
        "custom_intent": "תיאור Custom Intent Audience"
      },
      "best_channels": ["Facebook","Instagram","Google"],
      "best_posting_time": "יום ושעה אופטימלית",
      "ad_creative_tip": "טיפ ספציפי לקריאייטיב לקהל זה",
      "pain_point": "הכאב העיקרי של הקהל הזה",
      "purchase_trigger": "מה גורם לרכישה"
    }
  ]
}
חוק: כל פרופיל חייב להיות שונה. השתמש בשמות עניין ספציפיים שקיימים ב-Facebook Ads Manager.`,
      response_json_schema: { type: 'object' },
    });

    const segments = Array.isArray(result?.segments) ? result.segments : [];
    return res.json({ segments, data_quality: dataQuality });
  } catch (err: any) {
    console.error('[getAudienceSegments] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
