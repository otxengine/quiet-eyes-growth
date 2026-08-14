/**
 * getAudienceSegments — Intelligence-grounded audience builder for paid campaigns.
 *
 * Data sources (all loaded in parallel, used in LLM context):
 *  1. Reviews (up to 40) — sentiment, pain points, what customers say
 *  2. Leads (up to 30) — what services they needed, source channels
 *  3. Market signals — trends and signals the system detected
 *  4. TikTok audience data — REAL behavioral data from actual TikTok videos
 *     (saved by tiktokAudienceAgent: engagement rates, peak hours, top hashtags)
 *  5. Competitor intelligence — social channels, engagement levels, audiences
 *  6. Platform trends — what's trending for this sector right now
 *  7. Sector knowledge — cross-business patterns that work in this sector
 *
 * Dual-brain: Claude Sonnet (deep segmentation) + Gemini Flash (behavioral enrichment)
 * run in parallel, then merged.
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { callGemini } from '../../lib/gemini';

export async function getAudienceSegments(req: Request, res: Response) {
  const { businessProfileId, insight_text, action_type, post_content, image_description, platform, objective } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    // ── Load ALL intelligence in parallel ───────────────────────────────────
    const [
      profile,
      reviews,
      leads,
      signals,
      tiktokAudienceSignal,
      competitors,
      sectorKnowledge,
    ] = await Promise.all([
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
      // Most recent TikTok behavioral analysis from tiktokAudienceAgent
      prisma.marketSignal.findFirst({
        where: {
          linked_business: businessProfileId,
          category: 'tiktok_audience',
        },
        orderBy: { detected_at: 'desc' },
      }),
      // Competitor social intelligence
      prisma.competitor.findMany({
        where: { linked_business: businessProfileId },
        take: 8,
        select: {
          name: true,
          strongest_channel: true,
          engagement_level: true,
          social_followers_est: true,
          social_post_frequency: true,
          content_themes: true,
          sentiment_from_reviews: true,
        } as any,
      }),
      // Cross-business sector patterns
      prisma.sectorKnowledge.findFirst({
        where: { sector: { contains: '' } }, // most recent
        orderBy: { last_updated: 'desc' } as any,
      }),
    ]);

    // Load platform trends from raw SQL (not in Prisma schema)
    let platformTrends: any[] = [];
    try {
      platformTrends = await prisma.$queryRawUnsafe<any[]>(`
        SELECT trend_name, platform, trend_type, growth_rate, applicable_sectors, stage
        FROM platform_trend
        WHERE (linked_business = $1 OR applicable_sectors LIKE $2)
          AND created_at > NOW() - INTERVAL '14 days'
        ORDER BY growth_rate DESC NULLS LAST
        LIMIT 8
      `, businessProfileId, `%${profile?.category || ''}%`);
    } catch { /* table might not exist yet */ }

    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    // ── Parse TikTok behavioral intelligence ────────────────────────────────
    let tiktokData: any = null;
    if (tiktokAudienceSignal?.source_description) {
      try {
        tiktokData = JSON.parse(String(tiktokAudienceSignal.source_description));
      } catch { /* malformed JSON */ }
    }

    // ── Derive metrics from real data ────────────────────────────────────────
    const positiveReviews   = reviews.filter(r => r.sentiment === 'positive' || (r.rating || 0) >= 4);
    const negativeReviews   = reviews.filter(r => r.sentiment === 'negative' || (r.rating || 0) <= 2);
    const closedLeads        = leads.filter(l => l.status === 'completed' || l.status === 'closed_won');
    const hotLeads           = leads.filter(l => l.status === 'hot');
    const conversionRate     = leads.length > 0 ? Math.round((closedLeads.length / leads.length) * 100) : 0;

    const reviewSamples = reviews
      .slice(0, 6)
      .map(r => `[${r.sentiment || 'neutral'}/${r.rating || '?'}⭐] "${(r.text || '').slice(0, 60)}"`)
      .join('\n');

    const leadSamples = leads
      .slice(0, 5)
      .map(l => `"${(l.service_needed || l.name || '').slice(0, 50)}" (${l.source || '?'}, ${l.status})`)
      .join('\n');

    const closedLeadServices = closedLeads
      .map(l => (l.service_needed || '').slice(0, 50))
      .filter(Boolean)
      .join(', ');

    const signalSamples = signals
      .slice(0, 8)
      .map(s => `• ${(s.summary || '').slice(0, 100)}`)
      .join('\n');

    // ── Build competitor context ─────────────────────────────────────────────
    const competitorContext = competitors.length > 0
      ? competitors
          .map((c: any) => [
            `• ${c.name}`,
            c.strongest_channel ? `  ערוץ חזק: ${c.strongest_channel}` : null,
            c.engagement_level  ? `  engagement: ${c.engagement_level}` : null,
            c.social_followers_est ? `  עוקבים: ${c.social_followers_est}` : null,
            c.content_themes    ? `  תוכן: ${c.content_themes}` : null,
          ].filter(Boolean).join('\n'))
          .join('\n')
      : 'אין נתוני מתחרים';

    // ── Build TikTok behavioral context ─────────────────────────────────────
    const tiktokContext = tiktokData
      ? [
          `מבוסס על ${tiktokData.videos_analyzed || '?'} סרטונים אמיתיים:`,
          `• engagement ממוצע בסקטור: ${tiktokData.avg_sector_engagement || '?'}`,
          `• שעות שיא (ישראל): ${(tiktokData.best_posting_hours_il || []).join(', ') || '?'}`,
          `• hashtags עם engagement גבוה: ${(tiktokData.top_hashtags || []).slice(0, 5).join(', ') || '?'}`,
          tiktokData.primary_audience?.age_range
            ? `• גיל עיקרי: ${tiktokData.primary_audience.age_range}`
            : null,
          tiktokData.primary_audience?.gender_skew
            ? `• מגדר: ${tiktokData.primary_audience.gender_skew}`
            : null,
          tiktokData.hooks_that_work?.length
            ? `• hooks שעבדו: ${(tiktokData.hooks_that_work || []).slice(0, 2).join(' | ')}`
            : null,
        ].filter(Boolean).join('\n')
      : 'אין נתוני TikTok (טרם נסרק)';

    // ── Build platform trends context ────────────────────────────────────────
    const trendsContext = platformTrends.length > 0
      ? platformTrends
          .map(t => `• [${t.platform}] ${t.trend_name} — שלב: ${t.stage || '?'}, גדילה: ${t.growth_rate || '?'}x`)
          .join('\n')
      : 'אין טרנדים מזוהים לאחרונה';

    // ── Sector knowledge ─────────────────────────────────────────────────────
    const sectorCtx = (sectorKnowledge as any)?.patterns
      ? `תובנות סקטוריות: ${String((sectorKnowledge as any).patterns).slice(0, 200)}`
      : '';

    // ── Campaign context ─────────────────────────────────────────────────────
    const insightContext  = insight_text ? `\nתובנה: "${insight_text}"${action_type ? ` (${action_type})` : ''}` : '';
    const postContext     = post_content ? `\nתוכן הפוסט: "${post_content.slice(0, 300)}"` : '';
    const imageContext    = image_description ? `\nתמונה: ${image_description.slice(0, 150)}` : '';
    const campaignContext = [platform && `פלטפורמה: ${platform}`, objective && `מטרה: ${objective}`].filter(Boolean).join(' | ');

    const hasRealData = reviews.length >= 3 || leads.length >= 3 || tiktokData !== null;
    const dataQuality = tiktokData ? 'tiktok_enriched' : hasRealData ? 'real' : 'estimated';

    // ── Full intelligence prompt ─────────────────────────────────────────────
    const fullContext = `
=== פרופיל עסק ===
עסק: "${profile.name}" | ${profile.category} | ${profile.city}
שירותים: ${(profile as any).relevant_services || profile.category}
${campaignContext}${insightContext}${postContext}${imageContext}

=== נתוני לקוחות אמיתיים ===
ביקורות: ${reviews.length} (${positiveReviews.length} חיובי, ${negativeReviews.length} שלילי)
לידים: ${leads.length} | עסקות שנסגרו: ${closedLeads.length} | המרה: ${conversionRate}% | לידים חמים: ${hotLeads.length}
שירותים שלקוחות אמיתיים ביקשו: ${closedLeadServices || 'לא זמין'}

ביקורות (ישירות):
${reviewSamples || 'אין'}

לידים (ישירות):
${leadSamples || 'אין'}

=== ניתוח TikTok מהשטח ===
${tiktokContext}

=== מתחרים ===
${competitorContext}

=== טרנדים בסקטור ===
${trendsContext}

${sectorCtx ? `=== תבניות סקטוריאליות ===\n${sectorCtx}` : ''}

=== סיגנלים שהמערכת זיהתה ===
${signalSamples || 'אין'}
`.trim();

    // ── Claude Haiku — fast audience segmentation ────────────────────────────
    let result: any = null;
    let geminiEnrichment: any = null;

    const platformLabel = platform || 'facebook';
    const isPlatformTikTok = platformLabel === 'tiktok';

    try {
      result = await invokeLLM({
        model: 'haiku',
        maxTokens: 1100,
        skipCache: true,
        prompt: `You are a paid advertising expert specializing in the Israeli market.
Build 2 precise audience segments for a paid ${platformLabel} campaign based on the real business data below.

${fullContext}

════════════════════════════════════════
CRITICAL RULES — follow exactly:

META (Facebook/Instagram) — interests[] MUST be real strings from Facebook's interest taxonomy:
  ✅ Good: "Asian cuisine", "Sushi", "Japanese restaurant", "Food & dining", "Fine dining", "Takeaway food", "Cooking", "Foodie", "Restaurant"
  ✅ Good: city interests like "Tel Aviv" only when relevant — NOT as a substitute for topic interests
  ❌ Bad: Hebrew city names as interests, vague descriptions, invented categories
behaviors[] MUST be real Meta behaviors:
  ✅ Good: "Engaged shoppers", "Restaurant dining preference", "Facebook dining consumer", "Small business owners"
  ❌ Bad: invented behaviors not in Meta's taxonomy
custom_audience: actionable pixel/list audience (e.g. "Website visitors (30 days)", "Video viewers 75% (60 days)")
lookalike_source: specific source (e.g. "Customer email list", "Website purchasers (180 days)")
exclusions[]: who to exclude (e.g. "Existing customers (180 days)")

GOOGLE ADS — use proper match type syntax:
  Broad Modified: +keyword (e.g. "+מסעדה +אסייתית")
  Phrase Match:   "keyword" (e.g. "סושי זכרון יעקב")
  Exact Match:    [keyword] (e.g. [מסעדה אסייתית מקומית])
in_market_audiences[] MUST be from Google's taxonomy:
  ✅ Good: "Food & Dining/Restaurant Dining", "Food & Dining/Asian Cuisine Restaurants", "Beauty/Spas & Beauty Services"
  ❌ Bad: Hebrew categories not in Google's taxonomy

TIKTOK targeting:
interest_categories[] from TikTok's official taxonomy ONLY:
  ✅ Good: "Food & Beverage", "Restaurants", "Cooking", "Travel & Tourism", "Entertainment", "Fashion & Accessories", "Sports & Outdoor", "Beauty & Personal Care"
hashtags[]: real popular hashtags in the relevant language (#sushi, #israelifood, #אוכל)
creative_format: "In-Feed Ad" | "Spark Ads" | "TopView" | "Branded Hashtag Challenge"

AUDIENCE SIZE — estimate for Israeli market realistically:
  City-level (single city, e.g. Zichron Yaakov): 5,000–25,000
  Region-level (e.g. Haifa District): 20,000–80,000
  National Israel: 100,000–500,000
════════════════════════════════════════

Return ONLY valid JSON (no markdown):
{"segments":[{
  "segment_name": "Hebrew name max 6 words",
  "description": "1–2 sentences in Hebrew describing WHO this person is",
  "age_min": 25, "age_max": 45,
  "genders": "נשים וגברים",
  "income_level": "mid",
  "conversion_probability": 0.3,
  "estimated_size": "medium",
  "estimated_audience_range": "10,000–40,000",
  "why_this_segment": "Hebrew — why real data points to this segment",
  "pain_point": "Hebrew — specific pain from the data",
  "purchase_trigger": "Hebrew — what triggers the purchase",
  "best_channels": ["Facebook", "Instagram"],
  "best_posting_time": "ראשון-חמישי 18:00-21:00",
  "ad_creative_tip": "Hebrew — specific creative tip",
  "facebook_targeting": {
    "interests": ["Asian cuisine", "Sushi", "Food & dining"],
    "behaviors": ["Engaged shoppers", "Restaurant dining preference"],
    "custom_audience": "Website visitors (30 days)",
    "lookalike_source": "Customer email list",
    "exclusions": ["Existing customers (180 days)"]
  },
  "google_targeting": {
    "keywords": ["+מסעדה +אסייתית", '"סושי זכרון יעקב"', "[מסעדה אסייתית מקומית]"],
    "negative_keywords": ["חינם", "מתכון"],
    "in_market_audiences": ["Food & Dining/Restaurant Dining"],
    "custom_intent": "people searching for local restaurants"
  },
  "tiktok_targeting": {
    "interest_categories": ["Food & Beverage", "Restaurants"],
    "hashtags": ["#sushi", "#israelifood"],
    "creative_format": "In-Feed Ad",
    "age_group": "18-34"
  }
}]}`,
        response_json_schema: { type: 'object' },
      });
    } catch (llmErr: any) {
      console.warn('[getAudienceSegments] LLM failed:', llmErr.message);
    }

    // Gemini enrichment — fire-and-forget, won't block the response
    callGemini(
      `${fullContext}\n\nSuggest 2 behavioral keyword sets and a creative hook per segment.\nReturn ONLY valid JSON in Hebrew:\n{"segment_enrichments":[{"behavioral_keywords":["מילה1","מילה2"],"creative_hook":"הוק קצר","ad_format":"סוג מודעה","tiktok_hook":"פתיחת TikTok"}]}`,
      'gemini-flash', 300, { jsonMode: true },
    ).then(raw => {
      try { geminiEnrichment = JSON.parse(raw.replace(/```json?|```/g, '').trim()); } catch { /* ignore */ }
    }).catch(() => null);

    // ── Merge Gemini enrichment into Claude segments ─────────────────────────
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
            ].slice(0, 6),
          },
          ad_creative_tip: enrichment.creative_hook
            ? `${enrichment.creative_hook} — ${seg.ad_creative_tip || ''}`
            : seg.ad_creative_tip,
          tiktok_hook: enrichment.tiktok_hook || null,
          recommended_ad_format: enrichment.ad_format || null,
        };
      });
    }

    let segments = Array.isArray(result?.segments) ? result.segments : [];

    // ── Fallback: profile-based generic segments ─────────────────────────────
    if (segments.length === 0) {
      segments = [{
        segment_name: `לקוחות ${profile.category} מקומיים`,
        description: `תושבי ${profile.city} המחפשים ${profile.category}`,
        age_min: 25, age_max: 55, genders: 'נשים וגברים',
        income_level: 'mid', conversion_probability: 0.3,
        estimated_size: 'medium', estimated_audience_range: '10,000–40,000',
        why_this_segment: 'סגמנט בסיסי — לא נמצאו נתונים מספיקים לפילוח מדויק',
        facebook_targeting: {
          interests: [profile.category, profile.city, (profile as any).relevant_services || profile.category],
          behaviors: ['קונים מקוונים'], custom_audience: 'מבקרי האתר',
          lookalike_source: 'רשימת לקוחות', exclusions: [],
        },
        google_targeting: {
          keywords: [`${profile.category} ${profile.city}`, profile.name],
          negative_keywords: [], in_market_audiences: [profile.category], custom_intent: profile.category,
        },
        best_channels: ['Facebook', 'Instagram', 'Google'],
        best_posting_time: tiktokData?.best_posting_hours_il?.length
          ? `שעות שיא TikTok: ${tiktokData.best_posting_hours_il.slice(0, 2).join(', ')}`
          : 'ראשון-חמישי 18:00-21:00',
        ad_creative_tip: `הצג תמונות ${profile.category} איכותיות עם CTA ברור`,
        pain_point: `מחפשים ${profile.category} איכותי באזור ${profile.city}`,
        purchase_trigger: 'המלצה או מבצע',
      }];
    }

    // ── Build data sources summary for transparency ──────────────────────────
    const dataSources = {
      reviews:          reviews.length,
      leads:            leads.length,
      closed_deals:     closedLeads.length,
      hot_leads:        hotLeads.length,
      market_signals:   signals.length,
      tiktok_videos_analyzed: tiktokData?.videos_analyzed || 0,
      tiktok_data_age:  tiktokAudienceSignal
        ? Math.round((Date.now() - new Date((tiktokAudienceSignal as any).detected_at || Date.now()).getTime()) / 3600000) + 'h ago'
        : null,
      competitors_analyzed: competitors.length,
      platform_trends:  platformTrends.length,
      tiktok_enriched:  !!tiktokData,
      conversion_rate_pct: conversionRate,
    };

    return res.json({
      segments,
      data_quality: dataQuality,
      data_sources: dataSources,
    });

  } catch (err: any) {
    console.error('[getAudienceSegments] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
