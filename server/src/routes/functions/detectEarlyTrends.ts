/**
 * detectEarlyTrends — Agent that finds trends BEFORE they peak.
 *
 * Sources:
 *   • Google Trends velocity (SerpAPI) — measures 7d vs 30d growth acceleration
 *   • TikTok, Instagram Reels, YouTube Shorts — via Tavily social search
 *   • Reddit rising posts (r/Israel, niche subs) — early adopter signals
 *   • Israeli news aggregators & food/lifestyle blogs
 *   • Competitor activity spikes
 *
 * Scoring:
 *   • Velocity score: growth rate this week vs last week (wants HIGH velocity + LOW volume)
 *   • Stage filter: only "emerging" and "early_growing" pass — mainstream is excluded
 *   • Relevance: AI-scored against business sector, city, services
 *
 * Output: MarketSignals with source_description JSON containing velocity + days_to_peak
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';

import { tavilyAdvancedSearch } from '../../lib/tavily';
import { loadBusinessContext, formatContextForPrompt } from '../../lib/businessContext';
import { getTrendContext, isSignalIrrelevant } from '../../lib/trendContext';

const SERP_API_KEY = process.env.SERP_API_KEY || '';

// ── Google Trends velocity (SerpAPI) ──────────────────────────────────────────
// Returns growth % for last 7 days vs prior week, plus volume estimate.
async function fetchTrendsVelocity(keyword: string, geo = 'IL'): Promise<{
  growth7d: number;
  avgVolume: number; // 0-100 relative scale
  stage: 'emerging' | 'early_growing' | 'mainstream' | 'declining';
} | null> {
  if (!SERP_API_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', keyword);
    url.searchParams.set('geo', geo);
    url.searchParams.set('date', 'now 30-d');
    url.searchParams.set('api_key', SERP_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data: any = await res.json();
    const timeline: any[] = data?.interest_over_time?.timeline_data || [];
    if (timeline.length < 6) return null;

    const vals = timeline.map((d: any) => d?.values?.[0]?.extracted_value ?? 0);
    const last7  = vals.slice(-7);
    const prior7 = vals.slice(-14, -7);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const avgLast  = avg(last7);
    const avgPrior = avg(prior7);
    const avgAll   = avg(vals);

    const growth7d = avgPrior > 0 ? Math.round(((avgLast - avgPrior) / avgPrior) * 100) : 0;

    // Stage classification: pre-peak = high velocity + still low-mid volume
    let stage: 'emerging' | 'early_growing' | 'mainstream' | 'declining' = 'mainstream';
    if (avgAll < 25 && growth7d >= 60)       stage = 'emerging';      // Very early, fast rise
    else if (avgAll < 50 && growth7d >= 30)  stage = 'early_growing'; // Building momentum
    else if (growth7d < -20)                  stage = 'declining';
    else                                      stage = 'mainstream';

    return { growth7d, avgVolume: Math.round(avgAll), stage };
  } catch { return null; }
}

// ── Social platform trend queries (reduced from 10 → 5 to cut Tavily cost) ───
function buildSocialQueries(category: string, city: string, services: string): string[] {
  return [
    // TikTok + Instagram combined
    `TikTok OR Instagram viral trending ${category} Israel ${new Date().getFullYear()}`,
    // Reddit early adopters
    `Reddit r/Israel "${category}" rising OR popular new`,
    // Israeli news / lifestyle
    `${category} ${city} טרנד עולה 2025`,
    // Competitor / market moves
    `${category} ${city} opens new Israel`,
    // Niche communities
    `${services || category} Israel trend blog forum`,
  ];
}

// Minimum interval: trend signals don't change faster than 12h
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

// ── Main agent ─────────────────────────────────────────────────────────────────
export async function detectEarlyTrends(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  // ── Delta guard ───────────────────────────────────────────────────────────
  if (shouldSkipAgent(businessProfileId, 'detectEarlyTrends', MIN_INTERVAL_MS)) {
    return res.json({ trends_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city, relevant_services = '' } = profile;

    // Load business memory (rejected patterns + preferences)
    const bizCtx = await loadBusinessContext(businessProfileId);
    const memoryBlock = formatContextForPrompt(bizCtx, 'detectEarlyTrends');
    const rejectedPatterns: string[] = bizCtx?.rejectedPatterns || [];

    // Load AI intelligence context (sector profile + deep profile + trend types)
    const trendCtx = await getTrendContext(businessProfileId, 'detectEarlyTrends');

    // ── 1. Google Trends velocity scan ──────────────────────────────────────
    let trendsBlock = '';
    const trendKeywords = [
      category,
      `${category} ${city}`,
      `${category} ישראל`,
      ...(relevant_services || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 3),
    ];

    const velocityResults: Array<{ keyword: string; data: Awaited<ReturnType<typeof fetchTrendsVelocity>> }> = [];

    if (SERP_API_KEY) {
      const velocities = await Promise.all(trendKeywords.map(k => fetchTrendsVelocity(k)));
      velocities.forEach((v, i) => {
        if (v && (v.stage === 'emerging' || v.stage === 'early_growing')) {
          velocityResults.push({ keyword: trendKeywords[i], data: v });
        }
      });

      if (velocityResults.length > 0) {
        trendsBlock = '\n\n=== GOOGLE TRENDS VELOCITY (30-day window) ===\n' +
          velocityResults.map(x =>
            `"${x.keyword}": +${x.data!.growth7d}%/week, volume=${x.data!.avgVolume}/100, stage=${x.data!.stage}`
          ).join('\n') +
          '\n(stage "emerging" = low volume + high velocity = PRE-PEAK signal)';
      }
    }

    // ── 2. Social platform scanning ─────────────────────────────────────────
    const socialQueries = buildSocialQueries(category, city, relevant_services || '');
    const socialResults = await Promise.all(socialQueries.map(q => tavilyAdvancedSearch(q, 4)));
    const allSocial = socialResults.flat();

    // De-duplicate by URL
    const seenUrls = new Set<string>();
    const uniqueSocial = allSocial.filter(r => {
      if (!r.url || seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    });

    // ── 3. Competitor activity spikes (proxy for emerging demand) ───────────
    const competitorQueries = [
      `"${name}" OR "${category} ${city}" new launch opening 2025`,
      `${category} ${city} opens Israel new`,
    ];
    const competitorResults = (await Promise.all(competitorQueries.map(q => tavilyAdvancedSearch(q, 3)))).flat();

    // ── 3b. Cross-sector borrowing — adjacent sector trends ─────────────────
    // Find what's working in related sectors and see if it can be borrowed
    const ADJACENT_SECTORS: Record<string, string[]> = {
      'מסעדה': ['בית קפה', 'פיצה', 'קייטרינג'],
      'יופי': ['ספא', 'כושר', 'אופנה'],
      'כושר': ['ספא', 'יוגה', 'תזונה'],
      'רפואה': ['פיזיו', 'יוגה', 'בריאות'],
      'קמעונאות': ['אופנה', 'מתנות', 'מזון'],
      'שיפוץ': ['עיצוב פנים', 'ריהוט', 'נדל"ן'],
    };
    const catLower = category.toLowerCase();
    const adjacentSectors = Object.entries(ADJACENT_SECTORS)
      .find(([key]) => catLower.includes(key.toLowerCase()))?.[1] || [];
    let crossSectorContext = '';
    if (adjacentSectors.length > 0) {
      const crossQuery = `trending 2025 Israel ${adjacentSectors[0]} viral TikTok new service`;
      const crossResults = await tavilyAdvancedSearch(crossQuery, 3).catch(() => []);
      if (crossResults.length > 0) {
        crossSectorContext = '\n\n=== CROSS-SECTOR BORROWING (adjacent sectors) ===\n' +
          `Adjacent sectors: ${adjacentSectors.join(', ')}\n` +
          crossResults.slice(0, 3)
            .map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 150)}`)
            .join('\n---\n') +
          '\n(Consider: can trends from these adjacent sectors be adapted for this business?)';
      }
    }

    // ── 4. Build AI prompt ──────────────────────────────────────────────────
    const socialContext = uniqueSocial.slice(0, 18)
      .map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 250)}`)
      .join('\n---\n');

    const competitorContext = competitorResults.slice(0, 6)
      .map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 150)}`)
      .join('\n---\n');

    const fullContext = [
      socialContext ? `=== SOCIAL MEDIA SIGNALS ===\n${socialContext}` : '',
      trendsBlock,
      competitorContext ? `\n\n=== COMPETITOR/MARKET MOVES ===\n${competitorContext}` : '',
      crossSectorContext,
    ].filter(Boolean).join('\n\n');

    // ── 5. AI analysis — pre-peak trend scoring ─────────────────────────────
    const result = await invokeLLM({
      prompt: `You are a trends analyst specializing in discovering trends before they reach their peak.
Task: find 2-5 trends that are still in an "early stage" — not yet mainstream — but showing signs of rapid growth.
Return ONLY valid JSON. ALL string values must be in Hebrew.

Business: "${name}" — ${category} in ${city}
Services: ${relevant_services || 'not specified'}
${memoryBlock}
${trendCtx.sectorBlock}
${trendCtx.deepProfileBlock}
CRITICAL: ONLY include trends that directly relate to what this business actually offers: "${relevant_services || category}".
Do NOT include trends for products/services this business does not provide.
${rejectedPatterns.length > 0 ? `SKIP any trend related to: ${rejectedPatterns.slice(0, 5).join(', ')} (user dismissed these before)` : ''}
Set relevance_to_business="high" ONLY if the trend connects directly to at least one of the business's listed services.

Data:
${fullContext.slice(0, 3500)}

Important instructions:
• Include only trends that have specific evidence in the data above
• Reject trends that are already mainstream (everyone is talking about them = too late)
• Prefer: high velocity + low volume = gold
• Important: how many days until the trend reaches its peak? (range: 7-60 days)
• opportunity_text — what the business needs to do right now, very specific
• Cross-sector borrowing: if you see a trend succeeding in an adjacent sector that could apply here — flag it with stage="early_growing" and note the source sector in evidence
${trendCtx.trendTypesBlock}

Return ONLY valid JSON:
{"trends":[{
  "name": "שם הטרנד בעברית — עד 5 מילים",
  "description": "מה זה ולמה זה הולך להיות גדול — עד 15 מילה",
  "evidence": "ציטוט ספציפי או URL מהנתונים שמוכיח שהטרנד עולה",
  "source_platforms": ["tiktok","instagram","reddit","google_trends","news"],
  "stage": "emerging|early_growing",
  "velocity_score": 0-100,
  "days_to_peak_estimate": 7-60,
  "relevance_to_business": "high|medium",
  "opportunity_text": "פעולה ספציפית לעסק — פועל + תוצאה",
  "content_idea": "רעיון תוכן קונקרטי לנצל את הטרנד",
  "urgency": "high|medium",
  "confidence": 50-95,
  "trend_type": "purchase_intent|content_format|ad_method|language_shift|new_product_service|cultural_value|pricing_trend|sound_music|viral_challenge|seasonal_early"
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawTrends: any[] = result?.trends || [];

    // Filter: only truly early-stage, high relevance, passing rejection check
    const earlyTrends = rawTrends.filter(t => {
      if (!t.evidence || !t.name) return false;
      if (!['emerging', 'early_growing'].includes(t.stage)) return false;
      // Require explicit high relevance — medium is too ambiguous
      if (t.relevance_to_business !== 'high') return false;
      // Reject if matches a previously dismissed pattern
      const trendText = ((t.name || '') + ' ' + (t.description || '') + ' ' + (t.opportunity_text || '')).toLowerCase();
      if (rejectedPatterns.some((p: string) => p && trendText.includes(p.toLowerCase()))) return false;
      if (isSignalIrrelevant(trendText, trendCtx.irrelevantTopics)) return false;
      return true;
    });

    // ── 6. Save as MarketSignals ────────────────────────────────────────────
    const existing = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId },
      select: { summary: true },
    });
    const existingNames = new Set(existing.map(s => s.summary));

    let created = 0;
    for (const trend of earlyTrends) {
      if (existingNames.has(trend.name)) continue;

      const meta = JSON.stringify({
        action_type: 'social_post',
        action_label: trend.opportunity_text || trend.name,
        stage: trend.stage,
        velocity_score: trend.velocity_score,
        days_to_peak: trend.days_to_peak_estimate,
        content_idea: trend.content_idea,
        source_platforms: trend.source_platforms,
        trend_type: trend.trend_type || 'purchase_intent',
        is_early_trend: true,
      });

      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: `🔥 טרנד מוקדם: ${trend.name}`,
          impact_level: trend.urgency === 'high' ? 'high' : 'medium',
          category: 'early_trend',
          recommended_action: trend.opportunity_text || '',
          confidence: trend.confidence || 70,
          source_urls: trend.evidence?.slice(0, 200) || '',
          source_description: meta,
          is_read: false,
          detected_at: new Date().toISOString(),
        },
      });

      existingNames.add(trend.name);
      created++;
    }

    setLastRun(businessProfileId, 'detectEarlyTrends');
    await writeAutomationLog('detectEarlyTrends', businessProfileId, startTime, created);

    return res.json({
      trends_created: created,
      social_signals_scanned: uniqueSocial.length,
      google_trends_keywords: velocityResults.length,
      emerging_count: earlyTrends.filter(t => t.stage === 'emerging').length,
      early_growing_count: earlyTrends.filter(t => t.stage === 'early_growing').length,
    });

  } catch (err: any) {
    console.error('[detectEarlyTrends] error:', err.message);
    await writeAutomationLog('detectEarlyTrends', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
