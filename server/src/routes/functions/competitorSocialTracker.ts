import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';

const MIN_INTERVAL_MS      = 24 * 60 * 60 * 1000; // 24h between full runs
const CRAWL_INTERVAL_MS    =  7 * 24 * 60 * 60 * 1000; // re-crawl website for social links every 7 days

/**
 * competitorSocialTracker — two-phase competitor social intelligence agent.
 *
 * Phase 1 — Discovery (runs every 7 days per competitor):
 *   For each competitor without known social URLs (or with stale crawl):
 *   1. Searches for their website + social pages via Tavily
 *   2. Extracts Instagram / Facebook / TikTok page links
 *   3. Saves discovered URLs to Competitor record
 *
 * Phase 2 — Monitoring (runs every 24h):
 *   For each competitor (with or without known social URLs):
 *   1. Searches explicitly for: promotions/discounts, sponsored/paid ads, new products/services
 *   2. LLM extracts structured intelligence
 *   3. Creates ProactiveAlert (alert_type='competitor_social') + MarketSignal
 *
 * Fields written to Competitor:
 *   instagram_url, facebook_url, tiktok_url, website_url, social_pages_crawled_at,
 *   strongest_channel, social_post_frequency, content_themes, sentiment_from_reviews,
 *   last_promo_detected, last_promo_detected_at, last_product_detected,
 *   last_product_detected_at, sponsored_ads_detected, sponsored_ads_updated_at
 */
export async function competitorSocialTracker(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  if (!req.body.force && shouldSkipAgent(businessProfileId, 'competitorSocialTracker', MIN_INTERVAL_MS)) {
    return res.json({ processed: 0, skipped: true, reason: 'ran_recently' });
  }

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    if ((profile as any).monitor_competitors_social === false) {
      await writeAutomationLog('competitorSocialTracker', businessProfileId, startTime, 0);
      return res.json({ processed: 0, skipped: true, reason: 'competitor_monitoring_disabled' });
    }

    if (isTavilyRateLimited()) {
      await writeAutomationLog('competitorSocialTracker', businessProfileId, startTime, 0);
      return res.json({ processed: 0, skipped: true, reason: 'tavily_rate_limited' });
    }

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { last_scanned: 'asc' },
      take: 5,
    });

    if (competitors.length === 0) {
      await writeAutomationLog('competitorSocialTracker', businessProfileId, startTime, 0);
      return res.json({ processed: 0, note: 'No competitors found' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    let processed = 0;

    for (const comp of competitors) {
      if (isTavilyRateLimited()) break;
      try {
        const c = comp as any;

        // ── Phase 1: discover social page URLs ──────────────────────────────
        const needsCrawl =
          !c.social_pages_crawled_at ||
          new Date(c.social_pages_crawled_at).getTime() < Date.now() - CRAWL_INTERVAL_MS;

        if (needsCrawl) {
          await _discoverSocialPages(comp, profile);
        }

        // Reload record with possibly-updated URLs
        const fresh = (await prisma.competitor.findUnique({ where: { id: comp.id } })) as any;
        if (!fresh) continue;

        // ── Phase 2: monitor for promotions / ads / new products ────────────
        await _monitorSocialActivity(fresh, profile, businessProfileId, sevenDaysAgo);
        processed++;
      } catch (e: any) {
        console.warn(`[competitorSocialTracker] ${(comp as any).name}:`, e.message);
      }
    }

    setLastRun(businessProfileId, 'competitorSocialTracker');
    await writeAutomationLog('competitorSocialTracker', businessProfileId, startTime, processed);
    return res.json({ processed });
  } catch (err: any) {
    console.error('[competitorSocialTracker]', err.message);
    await writeAutomationLog('competitorSocialTracker', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Phase 1: discover social URLs from search ──────────────────────────────────

async function _discoverSocialPages(comp: any, profile: any) {
  const [igResults, fbResults, tikResults, siteResults] = await Promise.all([
    tavilySearch(`"${comp.name}" ${profile.city} site:instagram.com`, 3, 30),
    tavilySearch(`"${comp.name}" ${profile.city} site:facebook.com`, 3, 30),
    tavilySearch(`"${comp.name}" ${profile.city} site:tiktok.com`, 2, 30),
    tavilySearch(`"${comp.name}" ${profile.city} ${profile.category} אתר רשמי`, 3, 30),
  ]);

  const update: Record<string, any> = { social_pages_crawled_at: new Date().toISOString() };

  const igUrl  = igResults.find(r => r.url?.includes('instagram.com/'))?.url;
  const fbUrl  = fbResults.find(r => r.url?.includes('facebook.com/'))?.url;
  const tikUrl = tikResults.find(r => r.url?.includes('tiktok.com/'))?.url;
  const siteUrl = siteResults.find(r =>
    r.url &&
    !r.url.includes('instagram.com') &&
    !r.url.includes('facebook.com') &&
    !r.url.includes('tiktok.com') &&
    !r.url.includes('google.com') &&
    !r.url.includes('yad2') &&
    !r.url.includes('rest.co.il')
  )?.url;

  if (igUrl && !comp.instagram_url)  update.instagram_url = igUrl;
  if (fbUrl && !comp.facebook_url)   update.facebook_url  = fbUrl;
  if (tikUrl && !comp.tiktok_url)    update.tiktok_url    = tikUrl;
  if (siteUrl && !comp.website_url)  update.website_url   = siteUrl;

  console.log(
    `[competitorSocialTracker] ${comp.name}: ig=${!!igUrl} fb=${!!fbUrl} tik=${!!tikUrl} site=${!!siteUrl}`
  );

  await prisma.competitor.update({ where: { id: comp.id }, data: update }).catch(() => {});
}

// ── Phase 2: monitor social for promotions / sponsored ads / new products ──────

async function _monitorSocialActivity(
  comp: any,
  profile: any,
  businessProfileId: string,
  sevenDaysAgo: string,
) {
  const [promoResults, sponsoredResults, newProductResults, reviewResults] = await Promise.all([
    // Active promotions & discounts
    tavilySearch(`"${comp.name}" מבצע OR הנחה OR "% הנחה" OR חינם OR קופון`, 4, 30),
    // Sponsored / paid content
    tavilySearch(
      `"${comp.name}" ממומן OR sponsored OR פרסומת OR "קידום ממומן" site:facebook.com OR site:instagram.com`,
      3, 30
    ),
    // New products or services launched
    tavilySearch(
      `"${comp.name}" חדש OR "שירות חדש" OR "מוצר חדש" OR "פתחנו" OR "הוספנו" OR השקה`,
      4, 30
    ),
    // Reviews / reputation signals
    tavilySearch(`"${comp.name}" ביקורת OR "חוות דעת" OR "לא מומלץ" OR מצוין`, 3, 30),
  ]);

  const allResults = [
    ...promoResults.map(r => ({ ...r, _type: 'PROMO' })),
    ...sponsoredResults.map(r => ({ ...r, _type: 'SPONSORED' })),
    ...newProductResults.map(r => ({ ...r, _type: 'NEW_PRODUCT' })),
    ...reviewResults.map(r => ({ ...r, _type: 'REVIEW' })),
  ];

  if (allResults.length === 0) return;

  const textBlob = allResults
    .map(r => `[${r._type} | ${r.url}]\n${r.title}\n${(r.content || '').slice(0, 300)}`)
    .join('\n\n---\n\n');

  const analysis = await invokeLLM({
    model: 'haiku',
    maxTokens: 700,
    prompt: `You are a competitive intelligence analyst monitoring "${comp.name}" for the business "${profile.name}" (${profile.category}, ${profile.city}).

Recent web findings about this competitor:
${textBlob.slice(0, 3000)}

Extract structured intelligence. Return ONLY valid JSON. ALL string values MUST be in Hebrew:
{
  "has_active_promotion": true/false,
  "promotion_description": "תיאור המבצע הפעיל, או null",
  "is_running_paid_ads": true/false,
  "paid_ads_description": "תיאור הפרסום הממומן, או null",
  "new_service_or_product": "שם/תיאור שירות/מוצר חדש שהשיקו, או null",
  "strongest_channel": "instagram|facebook|tiktok|google|unknown",
  "social_post_frequency": "תדירות פרסום משוערת, או null",
  "content_themes": ["נושא1", "נושא2"],
  "main_weakness_from_reviews": "חולשה עיקרית מביקורות לקוחות, או null",
  "our_opportunity": "הזדמנות ספציפית לעסק שלנו בהתבסס על הממצאים, או null",
  "urgency": "high|medium|low"
}`,
    response_json_schema: { type: 'object' },
  }) as any;

  if (!analysis) return;

  // ── Persist enrichment to Competitor record ────────────────────────────
  const compUpdate: Record<string, any> = {};

  if (analysis.strongest_channel)       compUpdate.strongest_channel      = analysis.strongest_channel;
  if (analysis.social_post_frequency)   compUpdate.social_post_frequency  = analysis.social_post_frequency;
  if (analysis.content_themes?.length)  compUpdate.content_themes         = (analysis.content_themes as string[]).join(', ');
  if (analysis.main_weakness_from_reviews) compUpdate.sentiment_from_reviews = analysis.main_weakness_from_reviews;

  if (analysis.has_active_promotion && analysis.promotion_description) {
    compUpdate.last_promo_detected    = analysis.promotion_description;
    compUpdate.last_promo_detected_at = new Date().toISOString();
    compUpdate.current_promotions     = analysis.promotion_description;
  }
  if (analysis.new_service_or_product) {
    compUpdate.last_product_detected    = analysis.new_service_or_product;
    compUpdate.last_product_detected_at = new Date().toISOString();
  }
  if (typeof analysis.is_running_paid_ads === 'boolean') {
    compUpdate.sponsored_ads_detected   = analysis.is_running_paid_ads;
    compUpdate.sponsored_ads_updated_at = new Date().toISOString();
  }

  await prisma.competitor.update({ where: { id: comp.id }, data: compUpdate }).catch(() => {});

  // ── Only create alert when there is a concrete finding worth surfacing ──
  if (!analysis.our_opportunity) return;

  const existingAlert = await prisma.proactiveAlert.findFirst({
    where: {
      linked_business: businessProfileId,
      alert_type:      'competitor_social',
      title:           { contains: comp.name },
      is_dismissed:    false,
      created_at:      { gte: sevenDaysAgo },
    },
    select: { id: true },
  });
  if (existingAlert) return;

  // Build readable title
  let alertTitle: string;
  if (analysis.has_active_promotion && analysis.promotion_description) {
    alertTitle = `${comp.name}: מבצע פעיל — ${analysis.promotion_description.slice(0, 50)}`;
  } else if (analysis.is_running_paid_ads) {
    alertTitle = `${comp.name}: מריץ קמפיין ממומן`;
  } else if (analysis.new_service_or_product) {
    alertTitle = `${comp.name}: השיק ${analysis.new_service_or_product.slice(0, 40)}`;
  } else {
    alertTitle = `${comp.name}: עדכון תחרותי מסושיאל`;
  }

  const details: string[] = [];
  if (analysis.promotion_description)       details.push(`🏷️ מבצע: ${analysis.promotion_description}`);
  if (analysis.paid_ads_description)        details.push(`📣 פרסום ממומן: ${analysis.paid_ads_description}`);
  if (analysis.new_service_or_product)      details.push(`🆕 חדש: ${analysis.new_service_or_product}`);
  if (analysis.main_weakness_from_reviews)  details.push(`⚠️ חולשה: ${analysis.main_weakness_from_reviews}`);

  const prefilled = `עדכון תחרותי — ${comp.name}:\n\n${details.join('\n')}\n\n💡 הזדמנות: ${analysis.our_opportunity}`;

  await prisma.proactiveAlert.create({
    data: {
      linked_business:  businessProfileId,
      alert_type:       'competitor_social',
      title:            alertTitle,
      description:      details.length > 0 ? details.join('\n') : analysis.our_opportunity,
      suggested_action: analysis.our_opportunity,
      priority:         analysis.urgency === 'high' ? 'high' : 'medium',
      source_agent:     JSON.stringify({
        action_label:    'ראה הזדמנות',
        action_type:     'view',
        prefilled_text:  prefilled,
        urgency_hours:   analysis.urgency === 'high' ? 24 : 72,
        impact_reason:   `${comp.name} — פעילות סושיאל מזוהה`,
        competitor_id:   comp.id,
        competitor_name: comp.name,
        has_promotion:   analysis.has_active_promotion,
        has_paid_ads:    analysis.is_running_paid_ads,
      }),
      is_dismissed: false,
      is_acted_on:  false,
      created_at:   new Date().toISOString(),
    },
  }).catch(() => {});

  // ── MarketSignal for the Insights feed ────────────────────────────────
  await prisma.marketSignal.create({
    data: {
      linked_business:    businessProfileId,
      summary:            alertTitle,
      impact_level:       analysis.urgency === 'high' ? 'high' : 'medium',
      category:           'competitor_social',
      recommended_action: analysis.our_opportunity,
      confidence:         0.75,
      source_type:        'agent',
      agent_name:         'competitorSocialTracker',
      source_description: details.join(' | ') || '',
      is_dismissed:       false,
      detected_at:        new Date().toISOString(),
    },
  }).catch(() => {});

  console.log(`[competitorSocialTracker] ${comp.name}: alert created (${analysis.urgency})`);
}
