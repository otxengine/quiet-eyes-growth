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
        model: 'sonnet',
        maxTokens: 1500,
        prompt: `אתה מומחה לפרסום ממומן בשוק הישראלי עם ניסיון ב-Meta Ads וגוגל. בנה 3 סגמנטים ממוקדים ומבוססי נתונים.

עסק: "${profile.name}" | תחום: ${profile.category} | עיר: ${profile.city}
שירותים: ${profile.relevant_services || profile.category}
שוק יעד: ${profile.target_market || 'כללי'}
${profile.description ? `תיאור: ${profile.description}` : ''}
${insightContext}

נתונים אמיתיים:
• ${reviews.length} ביקורות | ${leads.length} לידים | המרה: ${conversionRate}%
${reviewSamples ? `ביקורות:\n${reviewSamples}` : ''}
${leadSamples ? `לידים לדוגמה:\n${leadSamples}` : ''}
${signalSamples ? `אותות שוק: ${signalSamples}` : ''}

הוראות:
- כל סגמנט חייב להיות שונה מהאחרים (גיל שונה / כוונת קנייה שונה / ערוץ שונה)
- pain_point ו-purchase_trigger: ספציפיים לסקטור ולנתונים (לא גנריים)
- Facebook interests: שמות ספציפיים של עמודים/תחומי עניין ב-Facebook Ads Manager
- ad_creative_tip: מה לצלם/לכתוב ספציפי לסגמנט זה

JSON עם בדיוק 3 סגמנטים:
{"segments":[{"segment_name":"שם ייחודי","description":"תיאור ספציפי עם פסיכוגרפיה","age_min":25,"age_max":45,"genders":"נשים וגברים","income_level":"mid","conversion_probability":0.3,"estimated_size":"medium","estimated_audience_range":"10,000-40,000","facebook_targeting":{"interests":["עניין ספציפי 1","עניין 2","עניין 3"],"behaviors":["התנהגות 1"],"custom_audience":"תיאור Custom Audience","lookalike_source":"מקור Lookalike","exclusions":["מה לא לטרגט"]},"google_targeting":{"keywords":["ביטוי מדויק 1","ביטוי 2"],"negative_keywords":["שלילה 1"],"in_market_audiences":["in-market 1"],"custom_intent":"תיאור custom intent"},"best_channels":["Facebook","Instagram"],"best_posting_time":"ימים + שעות ספציפיים","ad_creative_tip":"מה לצלם ומה לכתוב — ספציפי","pain_point":"כאב ספציפי של הסגמנט","purchase_trigger":"מה מניע אותם לקנות עכשיו"}]}`,
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
