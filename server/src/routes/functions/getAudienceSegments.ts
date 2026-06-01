import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { callGemini } from '../../lib/gemini';

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
  const { businessProfileId, insight_text, action_type, post_content, image_description, platform, objective } = req.body;
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
      ? `\nתובנה: "${insight_text}"${action_type ? ` (${action_type})` : ''}`
      : '';
    const postContext = post_content
      ? `\nתוכן הפוסט: "${post_content.slice(0, 300)}"`
      : '';
    const imageContext = image_description
      ? `\nתמונה: ${image_description.slice(0, 150)}`
      : '';
    const campaignContext = [
      platform ? `פלטפורמה: ${platform}` : '',
      objective ? `מטרה: ${objective}` : '',
    ].filter(Boolean).join(' | ');

    const audienceDataContext = `עסק: "${profile.name}" | ${profile.category} | ${profile.city}
שירותים: ${profile.relevant_services || profile.category}
${campaignContext}${insightContext}${postContext}${imageContext}
נתונים (OSINT): ${reviews.length} ביקורות (${positiveReviews.length} חיובי, ${negativeReviews.length} שלילי) | ${leads.length} לידים | המרה ${conversionRate}%
${reviewSamples ? `ביקורות: ${reviews.slice(0,5).map(r=>`"${(r.text||'').slice(0,60)}"`).join(' | ')}` : ''}
${leadSamples ? `לידים: ${leads.slice(0,5).map(l=>(l.service_needed||l.name||'').slice(0,40)).join(', ')}` : ''}`;

    // Dual-brain: Claude Sonnet (deep segmentation) + Gemini Flash (behavioral enrichment) in parallel
    let result: any = null;
    let geminiEnrichment: any = null;
    try {
      const [claudeResult, geminiRaw] = await Promise.all([
        // Claude Sonnet — deep demographic + conversion-focused segments
        invokeLLM({
          model: 'sonnet',
          maxTokens: 900,
          prompt: `פרסום ממומן ישראל — בנה 2 סגמנטי קהל יעד שונים המותאמים לתוכן הפוסט.

${audienceDataContext}
הנחיה: קהל היעד חייב לשקף מי יגיב לתוכן הפוסט הספציפי הזה — לא קהל יעד גנרי לעסק.

החזר JSON בלבד:
{"segments":[{"segment_name":"שם","description":"תיאור קצר","age_min":25,"age_max":45,"genders":"נשים וגברים","income_level":"mid","conversion_probability":0.3,"estimated_size":"medium","estimated_audience_range":"10,000-40,000","facebook_targeting":{"interests":["עניין 1","עניין 2","עניין 3"],"behaviors":["התנהגות"],"custom_audience":"Custom Audience","lookalike_source":"מקור","exclusions":[]},"google_targeting":{"keywords":["ביטוי 1","ביטוי 2"],"negative_keywords":[],"in_market_audiences":["קטגוריה"],"custom_intent":"כוונה"},"best_channels":["Facebook","Instagram"],"best_posting_time":"ראשון-חמישי 18:00-21:00","ad_creative_tip":"טיפ קריאייטיב","pain_point":"כאב","purchase_trigger":"טריגר"}]}`,
          response_json_schema: { type: 'object' },
          skipCache: true,
        }),
        // Gemini Flash — behavioral keywords + creative angle per segment (fast, parallel)
        callGemini(
          `${audienceDataContext}

Based on the OSINT data above, suggest 2 behavioral keyword sets (one per audience segment) and a creative hook for each.
Return ONLY valid JSON in Hebrew:
{"segment_enrichments":[{"behavioral_keywords":["מילה1","מילה2","מילה3"],"creative_hook":"הוק קריאייטיב קצר — עד 8 מילים","ad_format":"סוג מודעה מומלץ"}]}`,
          'gemini-flash', 300,
          { jsonMode: true },
        ).then(raw => {
          const clean = raw.replace(/```json?|```/g, '').trim();
          return JSON.parse(clean);
        }).catch(() => null),
      ]);

      result = claudeResult;
      geminiEnrichment = geminiRaw;
    } catch (llmErr: any) {
      console.warn('[getAudienceSegments] LLM failed, using fallback:', llmErr.message);
    }

    // Merge Gemini behavioral enrichment into Claude segments
    if (geminiEnrichment?.segment_enrichments?.length && Array.isArray(result?.segments)) {
      result.segments = result.segments.map((seg: any, i: number) => {
        const enrichment = geminiEnrichment.segment_enrichments[i];
        if (!enrichment) return seg;
        return {
          ...seg,
          facebook_targeting: {
            ...seg.facebook_targeting,
            behaviors: [
              ...(seg.facebook_targeting?.behaviors || []),
              ...(enrichment.behavioral_keywords || []),
            ].slice(0, 5),
          },
          ad_creative_tip: enrichment.creative_hook
            ? `${enrichment.creative_hook} — ${seg.ad_creative_tip || ''}`
            : seg.ad_creative_tip,
        };
      });
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
          facebook_targeting: { interests: [profile.category, profile.city, profile.relevant_services || profile.category], behaviors: ['קונים מקוונים'], custom_audience: 'מבקרי האתר', lookalike_source: 'רשימת לקוחות', exclusions: [] },
          google_targeting: { keywords: [`${profile.category} ${profile.city}`, profile.name], negative_keywords: [], in_market_audiences: [profile.category], custom_intent: profile.category },
          best_channels: ['Facebook', 'Instagram', 'Google'],
          best_posting_time: 'ראשון-חמישי 12:00–14:00',
          ad_creative_tip: `הצג תמונות ${profile.category} איכותיות עם CTA ברור`,
          pain_point: `מחפשים ${profile.category} איכותי באזור ${profile.city}`,
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
