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

    let result: any = null;
    try {
      result = await invokeLLM({
        model: 'haiku',
        maxTokens: 2000,
        prompt: `פרסום ממומן ישראלי. בנה 3 קהלי יעד לפייסבוק/גוגל עבור: "${profile.name}" (${profile.category}, ${profile.city}).
שירותים: ${profile.relevant_services || profile.category}. שוק: ${profile.target_market || 'כללי'}.${insightContext}
נתונים: ${reviews.length} ביקורות, ${leads.length} לידים (${conversionRate}% המרה).
ביקורות לדוגמה: ${reviewSamples || 'אין'}.

החזר JSON עם בדיוק 3 סגמנטים שונים:
{"segments":[{"segment_name":"...","description":"...","age_min":25,"age_max":45,"genders":"נשים וגברים","income_level":"mid","conversion_probability":0.3,"estimated_size":"medium","estimated_audience_range":"10,000-40,000","facebook_targeting":{"interests":["...","..."],"behaviors":["..."],"custom_audience":"...","lookalike_source":"...","exclusions":[]},"google_targeting":{"keywords":["...","..."],"negative_keywords":["..."],"in_market_audiences":["..."],"custom_intent":"..."},"best_channels":["Facebook","Instagram"],"best_posting_time":"...","ad_creative_tip":"...","pain_point":"...","purchase_trigger":"..."}]}`,
        response_json_schema: { type: 'object' },
      });
    } catch (llmErr: any) {
      console.warn('[getAudienceSegments] LLM failed, using fallback:', llmErr.message);
    }

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
