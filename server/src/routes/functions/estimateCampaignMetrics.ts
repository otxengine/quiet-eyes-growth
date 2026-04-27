import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { getBenchmark, getBudgetTiers } from '../../lib/campaignBenchmarks';

type Platform  = 'meta' | 'instagram' | 'google';
type Objective = 'awareness' | 'traffic' | 'leads' | 'conversions';

function range(low: number, mid: number, high: number) {
  return { low: Math.round(low), mid: Math.round(mid), high: Math.round(high) };
}

/**
 * estimateCampaignMetrics
 *
 * Returns realistic campaign predictions for a given budget/platform/objective,
 * using Israel market benchmarks + LLM-generated audience targeting in Ads format.
 *
 * Body: { businessProfileId, platform, daily_budget_ils, objective, campaign_days? }
 */
export async function estimateCampaignMetrics(req: Request, res: Response) {
  const {
    businessProfileId,
    platform = 'meta',
    daily_budget_ils,
    objective = 'leads',
    campaign_days = 7,
  } = req.body;

  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (!daily_budget_ils || daily_budget_ils <= 0) return res.status(400).json({ error: 'daily_budget_ils must be > 0' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city } = profile;
    const bm = getBenchmark(category, platform as Platform);
    const tiers = getBudgetTiers(category);
    const budget = Number(daily_budget_ils);
    const days   = Number(campaign_days);

    // ── Core metric calculations ───────────────────────────────────────────────
    // Impressions = (budget / CPM) × 1000
    const imp_low  = (budget / bm.cpm_high) * 1000;
    const imp_mid  = (budget / bm.cpm_mid)  * 1000;
    const imp_high = (budget / bm.cpm_low)  * 1000;

    // Reach = impressions / frequency
    const reach_low  = imp_low  / bm.frequency;
    const reach_mid  = imp_mid  / bm.frequency;
    const reach_high = imp_high / bm.frequency;

    // Clicks = impressions × CTR
    const clicks_low  = imp_low  * (bm.ctr_low  / 100);
    const clicks_mid  = imp_mid  * (bm.ctr_mid  / 100);
    const clicks_high = imp_high * (bm.ctr_high / 100);

    // Effective CPC = budget / clicks
    const cpc_eff_low  = clicks_high > 0 ? budget / clicks_high : bm.cpc_high;
    const cpc_eff_mid  = clicks_mid  > 0 ? budget / clicks_mid  : bm.cpc_mid;
    const cpc_eff_high = clicks_low  > 0 ? budget / clicks_low  : bm.cpc_low;

    // CVR depends on objective
    const cvrKey = (objective === 'conversions' || objective === 'leads') ? 'cvr_lead' : 'cvr_sale';
    const cvr = objective === 'leads' ? bm.cvr_lead :
                objective === 'conversions' ? bm.cvr_sale :
                (bm.cvr_lead + bm.cvr_sale) / 2;

    const leads_low  = Math.max(0, clicks_low  * (cvr / 100));
    const leads_mid  = Math.max(0, clicks_mid  * (cvr / 100));
    const leads_high = Math.max(0, clicks_high * (cvr / 100));

    const cpl_low  = leads_high > 0 ? budget / leads_high : 0;
    const cpl_mid  = leads_mid  > 0 ? budget / leads_mid  : 0;
    const cpl_high = leads_low  > 0 ? budget / leads_low  : 0;

    // ── Build Ads-format targeting via LLM ────────────────────────────────────
    const [reviews, leads_db] = await Promise.all([
      prisma.review.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 20,
        select: { text: true, sentiment: true, rating: true },
      }),
      prisma.lead.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { created_date: 'desc' },
        take: 15,
        select: { service_needed: true, source: true },
      }),
    ]);

    const reviewSample = reviews.slice(0, 8)
      .map(r => `[${r.sentiment}/${r.rating}⭐] "${(r.text || '').slice(0, 80)}"`)
      .join('\n');

    const platformLabel = platform === 'meta' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Google Ads';
    const objectiveLabel = { awareness: 'מודעות', traffic: 'תנועה', leads: 'לידים', conversions: 'המרות' }[objective] || objective;

    let targeting: any = null;
    try {
      targeting = await invokeLLM({
        model: 'haiku',
        maxTokens: 900,
        prompt: `בנה טרגטינג מדויק לקמפיין ${platformLabel} עבור "${name}" (${category} ב${city}).
מטרה: ${objectiveLabel} | תקציב יומי: ₪${budget}

ביקורות (${reviews.length}):
${reviewSample || 'אין'}

שירותים: ${profile.relevant_services || category}
שוק יעד: ${profile.target_market || 'לא צוין'}

${platform !== 'google' ? `החזר JSON בלבד:
{
  "fb_interests": ["עניין ספציפי ב-Facebook 1","עניין 2","עניין 3","עניין 4"],
  "fb_behaviors": ["התנהגות Facebook 1","התנהגות 2"],
  "age_min": 24,
  "age_max": 45,
  "genders": "נשים וגברים|נשים בלבד|גברים בלבד",
  "geo_radius_km": 20,
  "estimated_audience_min": 15000,
  "estimated_audience_max": 60000,
  "lookalike_seed": "תיאור קהל seed ל-Lookalike Audience",
  "retargeting_suggestion": "מה לרטרגט",
  "custom_audience_tip": "טיפ לCustom Audience"
}` : `החזר JSON בלבד:
{
  "keywords_exact": ["ביטוי מדויק 1","ביטוי מדויק 2","ביטוי מדויק 3"],
  "keywords_broad": ["ביטוי רחב 1","ביטוי רחב 2"],
  "keywords_negative": ["מילת שלילה 1","מילת שלילה 2"],
  "in_market_audiences": ["קהל in-market 1","קהל in-market 2"],
  "location_targeting": "${city} +20km",
  "ad_schedule": "ימים א-ו 11:00-22:00",
  "bid_strategy": "Maximize Conversions | Target CPA | Target ROAS"
}`}`,
        response_json_schema: { type: 'object' },
      });
    } catch (_) {}

    const result = {
      platform,
      objective,
      daily_budget: budget,
      campaign_days: days,
      total_budget: budget * days,
      category,
      business_name: name,
      city,
      metrics: {
        daily_impressions: range(imp_low,  imp_mid,  imp_high),
        daily_reach:       range(reach_low, reach_mid, reach_high),
        daily_clicks:      range(clicks_low, clicks_mid, clicks_high),
        ctr_pct:           { low: bm.ctr_low, mid: bm.ctr_mid, high: bm.ctr_high },
        cpc_ils:           { low: +cpc_eff_high.toFixed(2), mid: +cpc_eff_mid.toFixed(2), high: +cpc_eff_low.toFixed(2) },
        cpm_ils:           { low: bm.cpm_low, mid: bm.cpm_mid, high: bm.cpm_high },
        daily_leads:       range(leads_low, leads_mid, leads_high),
        cost_per_lead_ils: { low: +cpl_low.toFixed(1), mid: +cpl_mid.toFixed(1), high: +cpl_high.toFixed(1) },
        // Campaign totals
        total_impressions: range(imp_low * days,   imp_mid * days,   imp_high * days),
        total_reach:       range(reach_low * days, reach_mid * days, reach_high * days),
        total_clicks:      range(clicks_low * days, clicks_mid * days, clicks_high * days),
        total_leads:       range(leads_low * days, leads_mid * days, leads_high * days),
      },
      budget_tiers: tiers,
      targeting: targeting || null,
      benchmark_note: `ממוצעי שוק ישראל לסקטור ${category} על פלטפורמת ${platformLabel}`,
    };

    return res.json(result);
  } catch (err: any) {
    console.error('[estimateCampaignMetrics]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
