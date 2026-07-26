import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tavilySearch } from '../../lib/tavily';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h between runs

/**
 * analyzeCompetitorSocial
 * Searches for competitor social media presence and analyzes it via LLM.
 *
 * Body: { businessProfileId, competitorId? }
 * Returns: { analyzed: number, insights: CompetitorSocialInsight[] }
 */
export async function analyzeCompetitorSocial(req: Request, res: Response) {
  const { businessProfileId, competitorId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  try {
    const where: any = { linked_business: businessProfileId };
    if (competitorId) where.id = competitorId;

    const competitors = await prisma.competitor.findMany({ where });
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });

    if (profile?.monitor_competitors_social === false) {
      await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, new Date().toISOString(), 0);
      return res.json({ analyzed: 0, skipped: true, reason: 'competitor_monitoring_disabled' });
    }

    // 12h delta guard — social doesn't change faster than that
    if (!req.body.force && shouldSkipAgent(businessProfileId, 'analyzeCompetitorSocial', MIN_INTERVAL_MS)) {
      return res.json({ analyzed: 0, skipped: true, reason: 'ran_recently' });
    }

    const insights: any[] = [];

    for (const comp of competitors.slice(0, 5)) { // max 5 to control API usage
      try {
        // Use known social URLs if discovered, otherwise search by name
        const c = comp as any;
        const igQuery  = c.instagram_url
          ? `site:instagram.com "${comp.name}"` : `"${comp.name}" site:instagram.com`;
        const fbQuery  = c.facebook_url
          ? `site:facebook.com "${comp.name}"` : `"${comp.name}" site:facebook.com`;

        const socialResults = await Promise.all([
          tavilySearch(igQuery, 3),
          tavilySearch(fbQuery, 3),
          tavilySearch(`"${comp.name}" ביקורות לקוחות`, 3),
          // Active promotions, sponsored ads, new products — 14-day window only
          tavilySearch(`"${comp.name}" מבצע OR ממומן OR "שירות חדש" OR "מוצר חדש"`, 4, 14),
        ]);
        const allResults = socialResults.flat();
        if (allResults.length === 0) continue;

        const textBlob = allResults
          .map(r => `[${r.url}${r.published_date ? ` | ${r.published_date}` : ''}] ${r.title} — ${(r.content || '').slice(0, 200)}`)
          .join('\n\n');

        const analysis = await invokeLLM({
          model: 'sonnet',
          maxTokens: 700,
          prompt: `You are a senior competitive intelligence analyst. Analyze the digital presence and recent activity of "${comp.name}" to identify vulnerabilities and marketing moves.

My business: "${profile?.name}" | Sector: ${profile?.category} | City: ${profile?.city}
Competitor: "${comp.name}"

Web findings (social posts, reviews, promotions, ads):
${textBlob.slice(0, 2800)}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "strongest_channel": "instagram|facebook|google|tiktok|unknown",
  "content_themes": ["specific topic 1", "specific topic 2"],
  "main_weakness": "their clearest weakness — based on review complaints",
  "our_opportunity": "one specific actionable opportunity for my business — be concrete",
  "recommended_action": "verb + channel + specific content — up to 10 words",
  "sentiment_from_reviews": "positive|negative|mixed|unknown",
  "post_frequency": "e.g. 3 פוסטים בשבוע or daily or unknown",
  "has_active_promotion": false,
  "promotion_description": "current active promotion — ONLY if it appears to be running NOW (not expired, not historical). Return null if unsure.",
  "is_running_paid_ads": false,
  "paid_ads_description": "description of sponsored/paid ad campaign, or null",
  "new_service_or_product": "new service or product they recently launched, or null",
  "has_clear_opportunity": true
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (!analysis) continue;

        // ── Write structured social data to new competitor fields ─────────────
        const socialUpdate: Record<string, any> = {
          last_scanned: new Date().toISOString(),
        };
        if (analysis.strongest_channel)       socialUpdate.strongest_channel      = analysis.strongest_channel;
        if (analysis.sentiment_from_reviews)  socialUpdate.sentiment_from_reviews = analysis.sentiment_from_reviews;
        // Only update weaknesses from social if it's richer than what's stored
        if (analysis.main_weakness && (!comp.weaknesses || comp.weaknesses.length < 20)) {
          socialUpdate.weaknesses = analysis.main_weakness;
        }
        if (analysis.content_themes?.length)  socialUpdate.content_themes        = analysis.content_themes.join(', ');
        if (analysis.post_frequency)          socialUpdate.social_post_frequency = analysis.post_frequency;
        // Promotions & paid ads tracking
        if (analysis.has_active_promotion && analysis.promotion_description) {
          socialUpdate.last_promo_detected    = analysis.promotion_description;
          socialUpdate.last_promo_detected_at = new Date().toISOString();
          socialUpdate.current_promotions     = analysis.promotion_description;
        } else if ((comp as any).current_promotions) {
          socialUpdate.current_promotions = null;
        }
        if (analysis.new_service_or_product) {
          socialUpdate.last_product_detected    = analysis.new_service_or_product;
          socialUpdate.last_product_detected_at = new Date().toISOString();
        }
        // ponytail: detectCompetitorAds owns sponsored_ads_* — don't overwrite here (KAN-172)
        // Extract social URLs from search results (if not already stored)
        const c2 = comp as any;
        const igUrl = allResults.find(r => r.url?.includes('instagram.com/'))?.url;
        const fbUrl = allResults.find(r => r.url?.includes('facebook.com/'))?.url;
        if (igUrl && !c2.instagram_url) socialUpdate.instagram_url = igUrl;
        if (fbUrl && !c2.facebook_url)  socialUpdate.facebook_url  = fbUrl;

        await prisma.competitor.update({
          where: { id: comp.id },
          data: socialUpdate,
        }).catch(() => {});

        // ── Surface opportunity as ProactiveAlert (only when clear) ─────────
        if (analysis.has_clear_opportunity && analysis.our_opportunity && analysis.recommended_action) {
          const alertTitle = `${comp.name}: ${analysis.our_opportunity.slice(0, 70)}`;
          const existing = await prisma.proactiveAlert.findFirst({
            where: {
              linked_business: businessProfileId,
              alert_type: 'competitor_intel',
              title: { contains: comp.name },
              is_dismissed: false,
              created_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() },
            },
            select: { id: true },
          });
          if (!existing) {
            await prisma.proactiveAlert.create({
              data: {
                linked_business:  businessProfileId,
                alert_type:       'competitor_intel',
                title:            `🔍 ${alertTitle}`,
                description:      analysis.our_opportunity,
                suggested_action: analysis.recommended_action,
                priority:         'medium',
                source_agent:     JSON.stringify({
                  action_label:  analysis.recommended_action.split(' ').slice(0, 5).join(' '),
                  action_type:   'social_post',
                  prefilled_text: `ההזדמנות שלנו מול ${comp.name}:\n\n${analysis.our_opportunity}\n\nפעולה מוצעת: ${analysis.recommended_action}`,
                  urgency_hours: 72,
                  impact_reason: analysis.main_weakness ? `${comp.name} חלש ב: ${analysis.main_weakness.slice(0, 60)}` : '',
                }),
                is_dismissed: false,
                is_acted_on:  false,
                created_at:   new Date().toISOString(),
              },
            }).catch(() => {});
          }
        }

        // ── Alert for active promotion / paid ads / new product ─────────────
        const hasConcreteActivity =
          analysis.has_active_promotion || analysis.is_running_paid_ads || analysis.new_service_or_product;
        if (hasConcreteActivity) {
          const sevenDaysAgo2 = new Date(Date.now() - 7 * 86400000).toISOString();
          const existingSocial = await prisma.proactiveAlert.findFirst({
            where: {
              linked_business: businessProfileId,
              alert_type:      'competitor_social',
              title:           { contains: comp.name },
              is_dismissed:    false,
              created_at:      { gte: sevenDaysAgo2 },
            },
            select: { id: true },
          });
          if (!existingSocial) {
            let socialTitle = '';
            if (analysis.has_active_promotion)   socialTitle = `${comp.name}: מבצע פעיל — ${(analysis.promotion_description || '').slice(0, 50)}`;
            else if (analysis.is_running_paid_ads) socialTitle = `${comp.name}: מריץ קמפיין ממומן`;
            else                                   socialTitle = `${comp.name}: השיק ${(analysis.new_service_or_product || '').slice(0, 40)}`;

            const details: string[] = [];
            if (analysis.promotion_description)   details.push(`🏷️ מבצע: ${analysis.promotion_description}`);
            if (analysis.paid_ads_description)    details.push(`📣 פרסום ממומן: ${analysis.paid_ads_description}`);
            if (analysis.new_service_or_product)  details.push(`🆕 חדש: ${analysis.new_service_or_product}`);

            await prisma.proactiveAlert.create({
              data: {
                linked_business:  businessProfileId,
                alert_type:       'competitor_social',
                title:            socialTitle,
                description:      details.join('\n') || socialTitle,
                suggested_action: analysis.our_opportunity || analysis.recommended_action || '',
                priority:         analysis.has_active_promotion || analysis.is_running_paid_ads ? 'high' : 'medium',
                source_agent:     JSON.stringify({
                  action_label:    'ראה הזדמנות',
                  action_type:     'view',
                  prefilled_text:  `עדכון תחרותי — ${comp.name}:\n\n${details.join('\n')}\n\n💡 ${analysis.our_opportunity || ''}`,
                  urgency_hours:   analysis.has_active_promotion ? 24 : 72,
                  impact_reason:   `${comp.name} — פעילות שיווקית מזוהה`,
                  has_promotion:   analysis.has_active_promotion,
                  has_paid_ads:    analysis.is_running_paid_ads,
                }),
                is_dismissed: false,
                is_acted_on:  false,
                created_at:   new Date().toISOString(),
              },
            }).catch(() => {});
          }
        }

        // ── Publish to agent_data_bus ─────────────────────────────────────────
        await prisma.$executeRawUnsafe(
          `INSERT INTO agent_data_bus (event_type, source_agent, payload) VALUES ($1, $2, $3::jsonb)`,
          'competitor_social_analyzed',
          'analyzeCompetitorSocial',
          JSON.stringify({ competitorId: comp.id, competitorName: comp.name, analysis })
        ).catch(() => {});

        insights.push({ competitor_name: comp.name, ...analysis });
      } catch (_) { /* skip */ }
    }

    setLastRun(businessProfileId, 'analyzeCompetitorSocial');
    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, insights.length);
    return res.json({ analyzed: insights.length, insights });
  } catch (err: any) {
    console.error('[analyzeCompetitorSocial] error:', err.message);
    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
