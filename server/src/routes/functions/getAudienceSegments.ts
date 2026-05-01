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
      model: 'sonnet',
      maxTokens: 3000,
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

חובה להחזיר בדיוק 3 קהלי יעד שונים. אפילו אם אין נתונים, השתמש בידע שלך על הסקטור.
JSON:
{
  "segments": [
    {
      "segment_name": "שם קצר (עד 4 מילים)",
      "description": "תיאור הקהל — עד 15 מילה",
      "age_min": 24,
      "age_max": 45,
      "genders": "נשים וגברים",
      "income_level": "mid",
      "conversion_probability": 0.35,
      "estimated_size": "medium",
      "estimated_audience_range": "15,000–55,000",
      "facebook_targeting": {
        "interests": ["עניין 1","עניין 2","עניין 3"],
        "behaviors": ["התנהגות 1"],
        "custom_audience": "תיאור",
        "lookalike_source": "seed",
        "exclusions": ["מה לא לכלול"]
      },
      "google_targeting": {
        "keywords": ["ביטוי 1","ביטוי 2"],
        "negative_keywords": ["שלילה 1"],
        "in_market_audiences": ["קהל 1"],
        "custom_intent": "תיאור"
      },
      "best_channels": ["Facebook","Instagram"],
      "best_posting_time": "שישי 12:00",
      "ad_creative_tip": "טיפ לקריאייטיב",
      "pain_point": "כאב הקהל",
      "purchase_trigger": "גורם לרכישה"
    }
  ]
}`,
      response_json_schema: { type: 'object' },
    });

    let segments = Array.isArray(result?.segments) ? result.segments : [];

    // Fallback: if LLM returned nothing, build generic segments from profile
    if (segments.length === 0) {
      segments = [
        {
          segment_name: `לקוחות ${profile.category} מקומיים`,
          description: `תושבי ${profile.city} המחפשים ${profile.category}`,
          age_min: 25, age_max: 55, genders: 'נשים וגברים',
          income_level: 'mid', conversion_probability: 0.3,
          estimated_size: 'medium', estimated_audience_range: '10,000–40,000',
          facebook_targeting: { interests: [profile.category, profile.city, 'מסעדות'], behaviors: ['קונים מקוונים'], custom_audience: 'מבקרי האתר', lookalike_source: 'רשימת לקוחות', exclusions: [] },
          google_targeting: { keywords: [`${profile.category} ${profile.city}`, profile.name], negative_keywords: [], in_market_audiences: ['מסעדות ואוכל'], custom_intent: profile.category },
          best_channels: ['Facebook', 'Instagram', 'Google'],
          best_posting_time: 'ראשון-חמישי 12:00–14:00',
          ad_creative_tip: 'הצג תמונות מנות/שירות איכותיות עם CTA ברור',
          pain_point: 'מחפשים אפשרות אוכל/שירות איכותית באזור',
          purchase_trigger: 'מבצע או המלצה של חבר',
        },
      ];
    }

    return res.json({ segments, data_quality: dataQuality });
  } catch (err: any) {
    console.error('[getAudienceSegments] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
