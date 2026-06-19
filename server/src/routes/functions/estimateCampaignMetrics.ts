/**
 * estimateCampaignMetrics — Universal real-time campaign performance estimator.
 *
 * Data hierarchy (highest → lowest priority):
 *  1. Business's own past campaigns (actual_reach / actual_clicks / actual_leads)
 *  2. Live Tavily search: current sector-specific benchmarks, Israel market 2025
 *  3. LLM inference from comparable sectors based on search results
 *  4. Conservative industry defaults (last resort only)
 *
 * Works for ANY registered business — no hardcoded category list.
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch } from '../../lib/tavily';
import { getBenchmark, getBudgetTiers } from '../../lib/campaignBenchmarks';

// ── Tavily benchmark cache (24h TTL, process-level) ──────────────────────────
const _tavilyCache = new Map<string, { data: { snippets: string[]; urls: string[] }; ts: number }>();
const TAVILY_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedBenchmarks(key: string) {
  const entry = _tavilyCache.get(key);
  if (entry && Date.now() - entry.ts < TAVILY_CACHE_TTL) return entry.data;
  return null;
}
function setCachedBenchmarks(key: string, data: { snippets: string[]; urls: string[] }) {
  _tavilyCache.set(key, { data, ts: Date.now() });
}

type Platform  = 'meta' | 'instagram' | 'google';
type Objective = 'awareness' | 'traffic' | 'leads' | 'conversions';

function range(low: number, mid: number, high: number) {
  return { low: Math.round(low), mid: Math.round(mid), high: Math.round(high) };
}

interface Benchmark {
  cpm_low: number; cpm_mid: number; cpm_high: number;
  cpc_low: number; cpc_mid: number; cpc_high: number;
  ctr_low: number; ctr_mid: number; ctr_high: number;
  cvr_lead: number; cvr_sale: number;
  frequency: number;
  source: 'own_campaigns' | 'live_search' | 'llm_inferred' | 'default';
  source_urls?: string[];
}

// ── Step 1: fetch business's own past campaign performance ────────────────────

async function getHistoricalBenchmark(
  businessProfileId: string,
  platform: Platform,
): Promise<Partial<Benchmark> | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        actual_reach,
        actual_clicks,
        actual_leads,
        actual_spend_ils,
        campaign_days
      FROM campaigns
      WHERE linked_business  = $1
        AND platform          = $2
        AND actual_spend_ils  IS NOT NULL AND actual_spend_ils  > 0
        AND actual_reach      IS NOT NULL AND actual_reach      > 0
      ORDER BY published_at DESC
      LIMIT 5
    `, businessProfileId, platform);

    if (rows.length === 0) return null;

    // Aggregate actual performance across recent campaigns
    let totalSpend = 0, totalReach = 0, totalClicks = 0, totalLeads = 0, totalDays = 0;
    for (const r of rows) {
      totalSpend  += Number(r.actual_spend_ils)  || 0;
      totalReach  += Number(r.actual_reach)       || 0;
      totalClicks += Number(r.actual_clicks)      || 0;
      totalLeads  += Number(r.actual_leads)       || 0;
      totalDays   += Number(r.campaign_days)      || 1;
    }

    const avgDailySpend = totalSpend / totalDays;
    if (avgDailySpend <= 0 || totalReach <= 0) return null;

    // Derive metrics from actuals
    const cpm_mid    = (totalSpend / totalReach) * 1000;
    const ctr_mid    = totalClicks > 0 ? (totalClicks / (totalReach * 1.9)) * 100 : 2.0;
    const cvr_lead   = totalClicks > 0 && totalLeads > 0 ? (totalLeads / totalClicks) * 100 : 4.0;

    return {
      cpm_low: cpm_mid * 0.7, cpm_mid, cpm_high: cpm_mid * 1.4,
      cpc_low: cpm_mid / 10,  cpc_mid: cpm_mid / 8, cpc_high: cpm_mid / 6,
      ctr_low: ctr_mid * 0.6, ctr_mid, ctr_high: ctr_mid * 1.5,
      cvr_lead, cvr_sale: cvr_lead * 1.4,
      frequency: 1.9,
      source: 'own_campaigns',
    };
  } catch {
    return null;
  }
}

// ── Step 2: live Tavily search for current sector benchmarks ─────────────────

async function fetchLiveBenchmarks(
  category: string,
  platform: Platform,
  businessDescription: string,
): Promise<{ snippets: string[]; urls: string[] }> {
  const cacheKey = `${category}||${platform}`;
  const cached = getCachedBenchmarks(cacheKey);
  if (cached) return cached;

  const platformLabel = platform === 'meta' ? 'Facebook Meta' : platform === 'instagram' ? 'Instagram' : 'Google Ads';

  // Two complementary searches: one broad sector, one Israel-specific
  const [r1, r2] = await Promise.all([
    tavilySearch(
      `${platformLabel} ads CPM CPC CTR benchmark "${category}" Israel 2024 2025 cost per lead`,
      4,
    ),
    tavilySearch(
      `${platformLabel} advertising small business Israel ${category} conversion rate benchmark`,
      3,
    ),
  ]);

  const all = [...r1, ...r2];
  const snippets = all
    .map(r => `[${r.title}] ${(r.content || r.snippet || '').slice(0, 300)}`)
    .filter(Boolean);
  const urls = all.map(r => r.url).filter(Boolean);

  const result = { snippets, urls };
  setCachedBenchmarks(cacheKey, result);
  return result;
}

// ── Step 3: LLM parses live search results into structured benchmarks ─────────

async function parseLiveBenchmarks(
  snippets: string[],
  category: string,
  platform: Platform,
  businessDescription: string,
): Promise<Partial<Benchmark> & { source_urls?: string[] } | null> {
  if (snippets.length === 0) return null;

  const platformLabel = platform === 'meta' ? 'Facebook/Meta' : platform === 'instagram' ? 'Instagram' : 'Google Ads';

  try {
    const parsed = await invokeLLM({
      model: 'haiku',
      maxTokens: 500,
      skipCache: false,
      prompt: `You are an advertising benchmark analyst. Extract ${platformLabel} advertising performance metrics for a "${category}" business in Israel.

SEARCH RESULTS:
${snippets.slice(0, 6).join('\n\n')}

BUSINESS CONTEXT: ${businessDescription}

Extract realistic Israel-market benchmarks. If exact data is unavailable, infer from comparable sectors.
All monetary values in Israeli Shekels (₪). Return ONLY valid JSON:
{
  "cpm_low": <number>,
  "cpm_mid": <number>,
  "cpm_high": <number>,
  "cpc_low": <number>,
  "cpc_mid": <number>,
  "cpc_high": <number>,
  "ctr_low": <number>,
  "ctr_mid": <number>,
  "ctr_high": <number>,
  "cvr_lead": <number>,
  "cvr_sale": <number>,
  "frequency": <number>,
  "confidence": "high|medium|low",
  "reasoning": "<one sentence explaining the source of these numbers>"
}`,
      response_json_schema: { type: 'object' },
    });

    if (!parsed || typeof parsed.cpm_mid !== 'number') return null;

    // Sanity check — reject clearly wrong values (CPM > ₪500, CTR > 30%, etc.)
    if (parsed.cpm_mid > 500 || parsed.ctr_mid > 30 || parsed.cvr_lead > 50) return null;

    return {
      ...parsed,
      source: parsed.confidence === 'high' ? 'live_search' : 'llm_inferred',
    };
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

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
    const budget = Number(daily_budget_ils);
    const days   = Number(campaign_days);
    const platformLabel = platform === 'meta' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Google Ads';

    const businessDescription = [
      `עסק: ${name}`,
      `סקטור: ${category}`,
      `עיר: ${city}`,
      profile.relevant_services ? `שירותים: ${profile.relevant_services}` : null,
      profile.target_market     ? `קהל יעד: ${profile.target_market}` : null,
    ].filter(Boolean).join(', ');

    // ── Run all data sources in parallel ─────────────────────────────────────
    const [historicalBm, liveSearch] = await Promise.all([
      getHistoricalBenchmark(businessProfileId, platform as Platform),
      fetchLiveBenchmarks(category, platform as Platform, businessDescription),
    ]);

    // Parse live search results
    const liveBm = await parseLiveBenchmarks(
      liveSearch.snippets,
      category,
      platform as Platform,
      businessDescription,
    );

    // ── Select best benchmark (own campaigns > live search > default) ─────────
    let bm: Benchmark;
    let dataSource: string;
    let sourceUrls: string[] = liveSearch.urls.slice(0, 3);

    if (historicalBm && liveBm) {
      // Blend: own campaigns 60%, live search 40%
      bm = {
        cpm_low:  historicalBm.cpm_low!  * 0.6 + liveBm.cpm_low!  * 0.4,
        cpm_mid:  historicalBm.cpm_mid!  * 0.6 + liveBm.cpm_mid!  * 0.4,
        cpm_high: historicalBm.cpm_high! * 0.6 + liveBm.cpm_high! * 0.4,
        cpc_low:  historicalBm.cpc_low!  * 0.6 + liveBm.cpc_low!  * 0.4,
        cpc_mid:  historicalBm.cpc_mid!  * 0.6 + liveBm.cpc_mid!  * 0.4,
        cpc_high: historicalBm.cpc_high! * 0.6 + liveBm.cpc_high! * 0.4,
        ctr_low:  historicalBm.ctr_low!  * 0.6 + liveBm.ctr_low!  * 0.4,
        ctr_mid:  historicalBm.ctr_mid!  * 0.6 + liveBm.ctr_mid!  * 0.4,
        ctr_high: historicalBm.ctr_high! * 0.6 + liveBm.ctr_high! * 0.4,
        cvr_lead: historicalBm.cvr_lead! * 0.6 + liveBm.cvr_lead! * 0.4,
        cvr_sale: historicalBm.cvr_sale! * 0.6 + liveBm.cvr_sale! * 0.4,
        frequency: 1.9,
        source: 'own_campaigns',
        source_urls: sourceUrls,
      };
      dataSource = `ביצועי קמפיינים קודמים של העסק (60%) + נתוני שוק עדכניים ${new Date().getFullYear()} (40%)`;
    } else if (historicalBm) {
      bm = { frequency: 1.9, source_urls: [], ...historicalBm } as Benchmark;
      dataSource = `ביצועי קמפיינים קודמים של העסק — ${name}`;
    } else if (liveBm) {
      bm = { frequency: 1.9, source_urls: sourceUrls, ...liveBm } as Benchmark;
      const sourceLabel = liveBm.source === 'live_search' ? 'חיפוש חי' : 'הסקת LLM';
      dataSource = `נתוני שוק עדכניים ישראל ${new Date().getFullYear()} (${sourceLabel}) — ${(liveBm as any).reasoning || ''}`;
    } else {
      // Fallback to hardcoded defaults
      const fallback = getBenchmark(category, platform as Platform);
      bm = { ...fallback, source: 'default', source_urls: [] };
      dataSource = `ממוצעי תעשייה גנריים (לא נמצאו נתונים ספציפיים לסקטור "${category}")`;
    }

    // ── Core metric calculations ──────────────────────────────────────────────
    const imp_low  = (budget / bm.cpm_high) * 1000;
    const imp_mid  = (budget / bm.cpm_mid)  * 1000;
    const imp_high = (budget / bm.cpm_low)  * 1000;

    const reach_low  = imp_low  / bm.frequency;
    const reach_mid  = imp_mid  / bm.frequency;
    const reach_high = imp_high / bm.frequency;

    const clicks_low  = imp_low  * (bm.ctr_low  / 100);
    const clicks_mid  = imp_mid  * (bm.ctr_mid  / 100);
    const clicks_high = imp_high * (bm.ctr_high / 100);

    const cpc_eff_low  = clicks_high > 0 ? budget / clicks_high : bm.cpc_high;
    const cpc_eff_mid  = clicks_mid  > 0 ? budget / clicks_mid  : bm.cpc_mid;
    const cpc_eff_high = clicks_low  > 0 ? budget / clicks_low  : bm.cpc_low;

    const cvr = objective === 'leads'       ? bm.cvr_lead :
                objective === 'conversions' ? bm.cvr_sale :
                (bm.cvr_lead + bm.cvr_sale) / 2;

    const leads_low  = Math.max(0, clicks_low  * (cvr / 100));
    const leads_mid  = Math.max(0, clicks_mid  * (cvr / 100));
    const leads_high = Math.max(0, clicks_high * (cvr / 100));

    const cpl_low  = leads_high > 0 ? budget / leads_high : 0;
    const cpl_mid  = leads_mid  > 0 ? budget / leads_mid  : 0;
    const cpl_high = leads_low  > 0 ? budget / leads_low  : 0;

    // ── Build Ads-format targeting via LLM ───────────────────────────────────
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

    const objectiveLabel = { awareness: 'מודעות', traffic: 'תנועה', leads: 'לידים', conversions: 'המרות' }[objective] || objective;

    let targeting: any = null;
    try {
      targeting = await invokeLLM({
        model: 'sonnet',
        maxTokens: 900,
        prompt: `You are a ${platformLabel} Ads expert for the Israeli market. Build precise, data-driven targeting.
Return ONLY valid JSON. ALL string values must be in Hebrew.

Business: "${name}" | Sector: ${category} | City: ${city}
Campaign objective: ${objectiveLabel} | Daily budget: ₪${budget}
Services: ${(profile as any).relevant_services || category}
Target market: ${(profile as any).target_market || 'not specified'}

Real reviews (${reviews.length}):
${reviewSample || 'none'}

${platform !== 'google' ? `Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "fb_interests": ["עניין ספציפי ב-FB Ads Manager 1","עניין 2","עניין 3","עניין 4"],
  "fb_behaviors": ["התנהגות FB ספציפית 1","התנהגות 2"],
  "age_min": 24,
  "age_max": 45,
  "genders": "נשים וגברים|נשים בלבד|גברים בלבד",
  "geo_radius_km": 15,
  "estimated_audience_min": 15000,
  "estimated_audience_max": 60000,
  "lookalike_seed": "תיאור ספציפי של קהל seed — מי הם הלקוחות הכי טובים",
  "retargeting_suggestion": "מה לרטרגט ועם איזה מסר",
  "custom_audience_tip": "טיפ Custom Audience ספציפי לסקטור זה"
}` : `Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "keywords_exact": ["ביטוי מדויק בעברית 1","ביטוי 2","ביטוי 3"],
  "keywords_broad": ["ביטוי רחב 1","ביטוי רחב 2"],
  "keywords_negative": ["מילת שלילה 1","מילת שלילה 2"],
  "in_market_audiences": ["קהל in-market ספציפי 1","קהל 2"],
  "location_targeting": "${city} +15km",
  "ad_schedule": "ימים ושעות אופטימליים לסקטור זה",
  "bid_strategy": "אסטרטגיית הצעת מחיר המומלצת ולמה"
}`}`,
        response_json_schema: { type: 'object' },
      });
    } catch (_) {}

    const tiers = getBudgetTiers(category);

    return res.json({
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
        ctr_pct:           { low: +bm.ctr_low.toFixed(2), mid: +bm.ctr_mid.toFixed(2), high: +bm.ctr_high.toFixed(2) },
        cpc_ils:           { low: +cpc_eff_high.toFixed(2), mid: +cpc_eff_mid.toFixed(2), high: +cpc_eff_low.toFixed(2) },
        cpm_ils:           { low: +bm.cpm_low.toFixed(1), mid: +bm.cpm_mid.toFixed(1), high: +bm.cpm_high.toFixed(1) },
        daily_leads:       range(leads_low, leads_mid, leads_high),
        cost_per_lead_ils: { low: +cpl_low.toFixed(1), mid: +cpl_mid.toFixed(1), high: +cpl_high.toFixed(1) },
        total_impressions: range(imp_low * days,   imp_mid * days,   imp_high * days),
        total_reach:       range(reach_low * days, reach_mid * days, reach_high * days),
        total_clicks:      range(clicks_low * days, clicks_mid * days, clicks_high * days),
        total_leads:       range(leads_low * days, leads_mid * days, leads_high * days),
      },
      data_quality: {
        source: bm.source,
        description: dataSource,
        has_own_campaigns: !!historicalBm,
        has_live_benchmarks: !!liveBm,
        source_urls: bm.source_urls || [],
        freshness: new Date().toISOString(),
      },
      budget_tiers: tiers,
      targeting: targeting || null,
    });
  } catch (err: any) {
    console.error('[estimateCampaignMetrics]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
