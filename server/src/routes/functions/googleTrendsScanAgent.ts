/**
 * googleTrendsScanAgent — Dedicated Google Trends scanner.
 *
 * Scans both US (leading indicator) and IL for keyword velocity.
 * US trends typically precede IL trends by 2-6 weeks — flagged with
 * is_us_leading_indicator so the frontend can display them differently.
 *
 * Sources:
 *   • SerpAPI Google Trends (if SERP_API_KEY set)
 *   • Tavily web search fallback (trend-related articles)
 *
 * Memory: checkpoint per business+region prevents re-querying same keywords
 * within 24h — no wasted tokens.
 *
 * Output: MarketSignal with category='google_trend'
 *         platform_trend record for cross-business correlation
 *
 * Schedule: every 24h (called from scheduler.ts)
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';
import { invokeLLM } from '../../lib/llm';
import { tavilyAdvancedSearch } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import {
  loadCheckpoint, saveCheckpoint, shouldSkipByTime, filterNewUrls,
} from '../../lib/trendMemory';
import {
  hasSearchApiKey, searchTrendingNow, searchYouTubeTrends, searchGoogleNews,
} from '../../lib/searchapi';
import { loadDismissedTitles } from '../../lib/insightDedup';
import { sendOwnerWhatsAppNotification } from '../../services/execution/WhatsAppOwnerNotifier';

const SERP_API_KEY  = process.env.SERP_API_KEY  || '';
const MIN_INTERVAL  = 20 * 60 * 60 * 1000; // 20h — slightly less than 24h to handle schedule jitter

// ── Google Trends velocity via SerpAPI ────────────────────────────────────────

interface TrendsVelocity {
  growth7d:    number;
  avgVolume:   number; // 0-100 relative
  stage:       'emerging' | 'early_growing' | 'mainstream' | 'declining';
}

async function fetchVelocity(keyword: string, geo = 'IL'): Promise<TrendsVelocity | null> {
  if (!SERP_API_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine',  'google_trends');
    url.searchParams.set('q',       keyword);
    url.searchParams.set('geo',     geo);
    url.searchParams.set('date',    'now 30-d');
    url.searchParams.set('api_key', SERP_API_KEY);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const timeline: any[] = data?.interest_over_time?.timeline_data || [];
    if (timeline.length < 8) return null;

    const vals    = timeline.map((d: any) => d?.values?.[0]?.extracted_value ?? 0);
    const last7   = vals.slice(-7);
    const prior7  = vals.slice(-14, -7);
    const avg     = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const avgLast  = avg(last7);
    const avgPrior = avg(prior7);
    const avgAll   = avg(vals);
    const growth7d = avgPrior > 0 ? Math.round(((avgLast - avgPrior) / avgPrior) * 100) : 0;

    let stage: TrendsVelocity['stage'] = 'mainstream';
    if      (avgAll < 25 && growth7d >= 60) stage = 'emerging';
    else if (avgAll < 50 && growth7d >= 30) stage = 'early_growing';
    else if (growth7d < -20)                 stage = 'declining';

    return { growth7d, avgVolume: Math.round(avgAll), stage };
  } catch { return null; }
}

// ── Tavily fallback: trend articles ───────────────────────────────────────────

async function fetchTrendArticles(
  keywords: string[],
  country: string, // 'Israel' | 'United States'
): Promise<string[]> {
  const year = new Date().getFullYear();
  const queries = keywords.slice(0, 3).map(k =>
    `"${k}" trend ${country} ${year} rising growing popular`,
  );
  const results = (
    await Promise.all(queries.map(q => tavilyAdvancedSearch(q, 3).catch(() => [])))
  ).flat();
  const seen = new Set<string>();
  return results
    .filter(r => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; })
    .slice(0, 12)
    .map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 200)}`);
}

// ── Save to platform_trend table ──────────────────────────────────────────────

async function savePlatformTrend(
  name: string,
  stage: string,
  growth7d: number,
  avgVolume: number,
  region: string,
  businessId: string | null,
  evidence: string[],
  sectors: string[],
): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO platform_trend
         (id, platform, region, trend_type, trend_name, applicable_sectors,
          growth_rate, volume_estimate, stage, evidence_urls,
          is_us_leading_indicator, first_detected_at, last_seen_at,
          confidence, linked_business, source_agent)
       VALUES (
         gen_random_uuid()::text, 'google', $1, 'search_trend', $2, $3,
         $4, $5, $6, $7, $8, NOW(), NOW(), $9, $10, 'googleTrendsScanAgent'
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      region,
      name,
      JSON.stringify(sectors),
      growth7d,
      avgVolume,
      stage,
      JSON.stringify(evidence),
      region === 'US',
      Math.min(95, 50 + growth7d / 2),
      businessId,
    );
    return rows?.[0]?.id || null;
  } catch { return null; }
}

// ── Cross-platform gap analysis ───────────────────────────────────────────────
/**
 * Aggregates trend signals from all platforms (Google, TikTok, Instagram, viral),
 * enriches with SearchAPI real-time data, and runs gap analysis against the
 * business's known services.
 *
 * Anti-spam rules:
 *   • Max 2 ProactiveAlert (trend_gap) per week
 *   • 14-day dedup per trend name
 *   • Confidence ≥ 70 + evidence from 2+ platforms
 *   • Content trends saved silently as MarketSignal (no alert)
 */
async function runCrossPlatformGapAnalysis(
  businessProfileId: string,
  profile: {
    name: string;
    category: string;
    city: string;
    relevant_services?: string | null;
    description?: string | null;
  },
): Promise<{ gapsFound: number; contentTrendsFound: number }> {

  // ── Anti-spam: max 2 gap alerts per week ─────────────────────────────────
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const existingGapAlerts = await prisma.proactiveAlert.findMany({
    where: { linked_business: businessProfileId, alert_type: 'trend_gap', created_at: { gte: weekAgo } },
    select: { id: true },
  });
  if (existingGapAlerts.length >= 2) {
    console.log('[trendGap] weekly cap reached (2 alerts) — skipping');
    return { gapsFound: 0, contentTrendsFound: 0 };
  }
  const remainingSlots = 2 - existingGapAlerts.length;

  // ── Load recent signals from all platform agents (last 14 days) ──────────
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const platformSignals = await prisma.marketSignal.findMany({
    where: {
      linked_business: businessProfileId,
      category: { in: ['google_trend', 'tiktok_sector_trend', 'instagram_trend', 'viral'] },
      detected_at: { gte: fourteenDaysAgo },
    },
    select: { summary: true, category: true, recommended_action: true },
    orderBy: { detected_at: 'desc' },
    take: 40,
  });

  if (platformSignals.length < 2) {
    console.log('[trendGap] not enough cross-platform signals yet — skipping');
    return { gapsFound: 0, contentTrendsFound: 0 };
  }

  // ── SearchAPI real-time enrichment ───────────────────────────────────────
  let trendingNowBlock = '';
  let ytBlock = '';
  let newsBlock = '';

  if (hasSearchApiKey()) {
    const [trendingNow, ytTrends, newsHeadlines] = await Promise.allSettled([
      searchTrendingNow('IL'),
      searchYouTubeTrends(`${profile.category} ${profile.city}`),
      searchGoogleNews(`${profile.category} ישראל`),
    ]);

    const tn = trendingNow.status === 'fulfilled' ? trendingNow.value : [];
    const yt = ytTrends.status === 'fulfilled' ? ytTrends.value : [];
    const news = newsHeadlines.status === 'fulfilled' ? newsHeadlines.value : [];

    if (tn.length > 0)
      trendingNowBlock = `\nטרנדים חמים עכשיו בישראל (Google Trending Now):\n${tn.map(t => `• ${t.title} (${t.traffic})`).join('\n')}`;
    if (yt.length > 0)
      ytBlock = `\nYouTube — תוכן מוביל בסקטור:\n${yt.map(t => `• ${t}`).join('\n')}`;
    if (news.length > 0)
      newsBlock = `\nחדשות סקטור:\n${news.map(h => `• ${h}`).join('\n')}`;
  }

  // ── Claude Sonnet: gap analysis + content trends ─────────────────────────
  const platformBlock = platformSignals
    .map(s => `[${s.category.toUpperCase().replace('_', ' ')}] ${s.summary}`)
    .join('\n');

  const result = await invokeLLM({
    model: 'sonnet',
    maxTokens: 1200,
    prompt: `You are a business growth analyst for Israeli small businesses.
Business: "${profile.name}" (${profile.category}, ${profile.city})
Current services/products: ${profile.relevant_services || profile.description || 'not specified'}

Trend signals from the last 14 days across multiple platforms:
${platformBlock}
${trendingNowBlock}
${ytBlock}
${newsBlock}

TASK 1 — SERVICE/PRODUCT GAPS: Find 1-2 things trending in this sector that this business does NOT offer yet.
Be strict: only include if evidence appears in 2+ sources above AND it's realistic for this business to add.

TASK 2 — CONTENT TRENDS: Find 1-3 content formats/styles going viral for this type of business.
These are HOW to create content, not what product to sell.

Rules:
• Product gaps: confidence ≥ 70, platform_count ≥ 2, actionable within 2 weeks
• Content trends: confidence ≥ 60, specific enough to act on immediately
• If no clear evidence → return empty arrays. Do NOT invent opportunities.
• ALL string values in Hebrew

Return ONLY valid JSON:
{
  "product_gaps": [{
    "trend_name": "שם הטרנד — קצר",
    "what_is_missing": "מה העסק לא מציע כרגע",
    "evidence": "מאיפה רואים את זה — ציין פלטפורמות",
    "platform_count": 2,
    "confidence": 75,
    "action_plan": "שלב 1: X | שלב 2: Y | שלב 3: לאנץ' + תוכן",
    "launch_post": "פוסט הכרזה מוכן — 3-4 משפטים בעברית, לא שיווקי מדי",
    "urgency": "high|medium"
  }],
  "content_trends": [{
    "trend_name": "שם תבנית התוכן",
    "description": "מה עובד ולמה בסקטור זה",
    "example_hook": "שורה ראשונה לפוסט/ריל שעובדת",
    "platform": "tiktok|instagram|both",
    "confidence": 65
  }]
}`,
    response_json_schema: { type: 'object' },
  }) as any;

  if (!result) return { gapsFound: 0, contentTrendsFound: 0 };

  const productGaps: any[]    = result.product_gaps    || [];
  const contentTrends: any[]  = result.content_trends  || [];
  let gapsFound          = 0;
  let contentTrendsFound = 0;

  // Load dismissed titles to prevent recreating insights the user dismissed
  const dedup = await loadDismissedTitles(businessProfileId, 30);

  // ── Save product gap ProactiveAlerts ────────────────────────────────────
  for (const gap of productGaps.slice(0, remainingSlots)) {
    if ((gap.confidence || 0) < 70 || (gap.platform_count || 0) < 2) continue;

    const gapTitle = `📈 טרנד בסקטור שלך: ${gap.trend_name}`;
    if (dedup.hasAlert(gapTitle)) continue;

    // 14-day dedup (also catches active undismissed records)
    const dupCheck = await prisma.proactiveAlert.findFirst({
      where: {
        linked_business: businessProfileId,
        alert_type:      'trend_gap',
        title:           { contains: (gap.trend_name || '').slice(0, 20) },
        created_at:      { gte: fourteenDaysAgo },
      },
      select: { id: true },
    });
    if (dupCheck) continue;

    await prisma.proactiveAlert.create({
      data: {
        linked_business:  businessProfileId,
        alert_type:       'trend_gap',
        title:            gapTitle,
        description:      `🎯 מה חסר: ${gap.what_is_missing}\n📊 ראיות: ${gap.evidence}\n\n📋 תוכנית: ${gap.action_plan}`,
        suggested_action: gap.launch_post || gap.action_plan || '',
        priority:         gap.urgency === 'high' ? 'high' : 'medium',
        source_agent:     JSON.stringify({
          action_label:    'צור תוכן לאנץ\'',
          action_type:     'social_post',
          prefilled_text:  gap.launch_post || '',
          urgency_hours:   gap.urgency === 'high' ? 72 : 168,
          impact_reason:   `${gap.trend_name} עולה ב-${gap.evidence}`,
          trend_name:      gap.trend_name,
          platform_count:  gap.platform_count,
          confidence:      gap.confidence,
        }),
        is_dismissed: false,
        is_acted_on:  false,
        created_at:   new Date().toISOString(),
      },
    }).catch(() => {});

    // Notify owner via WhatsApp — trend gaps are high-value opportunities
    sendOwnerWhatsAppNotification({
      businessProfileId,
      actionDescription: `📈 טרנד עולה בסקטור שלך שחסר בשירותים שלך: ${gap.trend_name}`,
      agentName: 'סריקת טרנדים Google',
    }).catch(() => {});

    // Also save as MarketSignal for agent consumption
    await prisma.marketSignal.create({
      data: {
        linked_business:    businessProfileId,
        summary:            `📈 ${gap.trend_name} — טרנד עולה שחסר בשירותים שלך`,
        impact_level:       gap.urgency === 'high' ? 'high' : 'medium',
        category:           'trend_gap',
        recommended_action: gap.action_plan || '',
        confidence:         gap.confidence || 70,
        source_type:        'agent',
        agent_name:         'googleTrendsScanAgent',
        source_description: gap.evidence || '',
        is_dismissed:       false,
        detected_at:        new Date().toISOString(),
      },
    }).catch(() => {});

    gapsFound++;
  }

  // ── Save content trends silently as MarketSignal (feeds content agents) ──
  for (const ct of contentTrends.slice(0, 3)) {
    if ((ct.confidence || 0) < 60) continue;

    // 7-day dedup
    const ctDup = await prisma.marketSignal.findFirst({
      where: {
        linked_business: businessProfileId,
        category:        'content_trend',
        summary:         { contains: (ct.trend_name || '').slice(0, 20) },
        detected_at:     { gte: weekAgo },
      },
      select: { id: true },
    });
    if (ctDup) continue;

    await prisma.marketSignal.create({
      data: {
        linked_business:    businessProfileId,
        summary:            `🎬 תבנית תוכן ויראלי: ${ct.trend_name}`,
        impact_level:       'medium',
        category:           'content_trend',
        recommended_action: ct.example_hook || ct.description || '',
        confidence:         ct.confidence || 60,
        source_type:        'agent',
        agent_name:         'googleTrendsScanAgent',
        source_description: JSON.stringify({
          description:  ct.description,
          example_hook: ct.example_hook,
          platform:     ct.platform,
        }),
        is_dismissed:       false,
        detected_at:        new Date().toISOString(),
      },
    }).catch(() => {});

    contentTrendsFound++;
  }

  console.log(`[trendGap] gaps=${gapsFound} content_trends=${contentTrendsFound}`);
  return { gapsFound, contentTrendsFound };
}

// ── Main agent ─────────────────────────────────────────────────────────────────

export async function googleTrendsScanAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const { name, category, city, relevant_services = '' } = profile;

    // ── Checkpoint: skip if ran < 20h ago ─────────────────────────────────
    const cpIL = await loadCheckpoint('googleTrendsScanAgent', businessProfileId, 'google', 'IL');
    const cpUS = await loadCheckpoint('googleTrendsScanAgent', businessProfileId, 'google', 'US');
    if (shouldSkipByTime(cpIL, MIN_INTERVAL) && shouldSkipByTime(cpUS, MIN_INTERVAL)) {
      return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
    }

    // ── Build keywords universally from business profile ───────────────────
    // Use Claude Haiku to generate relevant search keywords — works for any sector
    const keywordResult = await callAIJson<{ keywords: string[] }>('classify_sector',
      `Business: "${name}", category: "${category}", services: "${relevant_services || category}", city: "${city}".
Generate 6 specific Google search keywords in Hebrew (and 2 in English) that would reveal rising trends
for this exact type of business. Keywords should be specific to what customers search when looking for
this service. Return ONLY valid JSON: {"keywords": ["keyword1", "keyword2", ...]}`
    ).catch(() => ({ keywords: [category, `${category} ${city}`, relevant_services.split(',')[0]?.trim() || category] }));

    const keywords: string[] = [
      ...(keywordResult.keywords || []).slice(0, 8),
      category,
      `${category} ישראל`,
    ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);

    let signalsCreated = 0;
    const newUrlsAll: string[] = [];

    // ── Scan IL and US ─────────────────────────────────────────────────────
    for (const region of ['IL', 'US'] as const) {
      const geo    = region;
      const cp     = region === 'IL' ? cpIL : cpUS;
      const country = region === 'IL' ? 'Israel' : 'United States';

      if (shouldSkipByTime(cp, MIN_INTERVAL)) continue;

      const velocityResults: Array<{
        keyword: string;
        growth7d: number;
        avgVolume: number;
        stage: string;
      }> = [];

      // SerpAPI scan (if available)
      if (SERP_API_KEY) {
        const velocities = await Promise.all(keywords.slice(0, 6).map(k => fetchVelocity(k, geo)));
        velocities.forEach((v, i) => {
          if (v && (v.stage === 'emerging' || v.stage === 'early_growing')) {
            velocityResults.push({ keyword: keywords[i], ...v });
          }
        });
      }

      // Tavily articles for context (only URLs not yet seen)
      const articles = await fetchTrendArticles(keywords.slice(0, 3), country);
      const newArticleUrls = filterNewUrls(articles.map(a => a.split(']')[0].replace('[', '')), cp);

      if (velocityResults.length === 0 && newArticleUrls.length === 0) {
        await saveCheckpoint(cp, { region, scanned_at: new Date().toISOString() });
        continue;
      }

      // ── AI analysis ─────────────────────────────────────────────────────
      const trendsBlock = velocityResults.length > 0
        ? `Google Trends velocity (30-day window, geo=${geo}):\n` +
          velocityResults.map(x =>
            `"${x.keyword}": +${x.growth7d}%/week, volume=${x.avgVolume}/100, stage=${x.stage}`
          ).join('\n')
        : '';

      const articlesBlock = articles.slice(0, 10).join('\n---\n');

      const result = await callAIJson<{ trends: any[] }>('classify_sector',
        `You are a trend analyst. Identify 1-4 rising search trends for this business.
Business: "${name}" — ${category} in ${city}
Country: ${country}
Services: ${relevant_services || 'not specified'}
${region === 'US' ? 'NOTE: These are US trends — they typically reach Israel 2-6 weeks later (leading indicator).' : ''}

${trendsBlock}
${articlesBlock ? `\nWeb articles:\n${articlesBlock.slice(0, 2500)}` : ''}

Rules:
• Only include trends with clear evidence above
• Must be relevant to this business's actual services
• For US trends: estimate days_until_israel (14-60)

Return ONLY valid JSON. ALL string values in Hebrew:
{"trends":[{
  "name": "שם הטרנד — עד 5 מילים",
  "description": "מה עולה ולמה — עד 12 מילה",
  "keyword": "מילת המפתח מ-Google Trends",
  "growth_pct": 0,
  "stage": "emerging|early_growing",
  "evidence": "ציטוט/URL ספציפי",
  "days_until_israel": 0,
  "opportunity": "מה העסק צריך לעשות עכשיו — פעולה ספציפית",
  "confidence": 60
}]}`
      ).catch(() => ({ trends: [] }));

      const rawTrends: any[] = result?.trends || [];
      const validTrends = rawTrends.filter(t =>
        t.name && t.evidence && (t.confidence || 0) >= 55,
      );

      // Dedup against existing 24h signals + dismissed records (last 30 days)
      const existing = await prisma.marketSignal.findMany({
        where: {
          linked_business: businessProfileId,
          category: 'google_trend',
          detected_at: { gte: new Date(Date.now() - 24 * 3600000).toISOString() },
        },
        select: { summary: true },
      });
      const existingNames = new Set(existing.map(s => s.summary));
      const signalDedup = await loadDismissedTitles(businessProfileId, 30);

      for (const trend of validTrends) {
        const prefix = region === 'US' ? '🇺🇸 גוגל US: ' : 'גוגל: ';
        const summaryKey = `${prefix}${trend.name}`;
        if (existingNames.has(summaryKey) || signalDedup.hasSignal(summaryKey)) continue;

        const meta = JSON.stringify({
          action_type:           'content_opportunity',
          action_label:          trend.opportunity || trend.name,
          region,
          is_us_leading_indicator: region === 'US',
          days_until_israel:       region === 'US' ? (trend.days_until_israel || 21) : 0,
          growth_pct:              trend.growth_pct || 0,
          stage:                   trend.stage,
          keyword:                 trend.keyword,
          evidence:                trend.evidence,
          source_agent:            'googleTrendsScanAgent',
        });

        await prisma.marketSignal.create({
          data: {
            linked_business:    businessProfileId,
            summary:            summaryKey,
            impact_level:       trend.stage === 'emerging' ? 'high' : 'medium',
            category:           'google_trend',
            recommended_action: trend.opportunity || '',
            confidence:         trend.confidence || 65,
            source_urls:        trend.evidence?.startsWith('http') ? trend.evidence : '',
            source_description: meta,
            is_read:            false,
            is_dismissed:       false,
            detected_at:        new Date().toISOString(),
          },
        });

        // Save to platform_trend
        await savePlatformTrend(
          trend.name,
          trend.stage,
          trend.growth_pct || 0,
          velocityResults.find(v => v.keyword === trend.keyword)?.avgVolume || 50,
          region,
          businessProfileId,
          [trend.evidence].filter(Boolean),
          [category],
        );

        existingNames.add(summaryKey);
        signalsCreated++;
      }

      // Update checkpoint
      const scannedArticleUrls = articles.map(a => a.split(']')[0].replace('[', ''));
      scannedArticleUrls.forEach(u => cp.scannedUrls.add(u));
      newUrlsAll.push(...scannedArticleUrls);
      await saveCheckpoint(cp, {
        region,
        keywords_scanned: keywords.length,
        velocity_signals: velocityResults.length,
        trends_saved: signalsCreated,
        scanned_at: new Date().toISOString(),
      });
    }

    // ── Cross-platform gap analysis (runs after Google signals are saved) ────
    const { gapsFound, contentTrendsFound } = await runCrossPlatformGapAnalysis(
      businessProfileId,
      { name: name as string, category: category as string, city: city as string,
        relevant_services: (profile as any).relevant_services,
        description: (profile as any).description },
    );
    signalsCreated += gapsFound + contentTrendsFound;

    await writeAutomationLog('googleTrendsScanAgent', businessProfileId, startTime, signalsCreated);
    console.log(`[googleTrendsScanAgent] done: ${signalsCreated} signals (gaps=${gapsFound} content_trends=${contentTrendsFound})`);
    return res.json({ signals_created: signalsCreated, gaps_found: gapsFound, content_trends_found: contentTrendsFound });

  } catch (err: any) {
    console.error('[googleTrendsScanAgent] error:', err.message);
    await writeAutomationLog('googleTrendsScanAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
