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

import { tavilyAdvancedSearch } from '../../lib/tavily';

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

// ── Social platform trend queries ─────────────────────────────────────────────
function buildSocialQueries(category: string, city: string, services: string): string[] {
  const catEn = category.replace(/[^\x00-\x7F]/g, '').trim() || category;
  return [
    // TikTok early signals
    `site:tiktok.com trending ${category} Israel ${new Date().getFullYear()}`,
    `TikTok viral ${category} ${city} trend 2025`,
    // Instagram Reels trends
    `Instagram Reels trending ${category} Israel`,
    `Instagram hashtag growing ${category} ${city}`,
    // Reddit early adopters
    `Reddit r/Israel OR r/tel_aviv "${category}" rising`,
    `Reddit "${category}" "${city}" popular new`,
    // YouTube Shorts
    `YouTube Shorts trending ${category} Israel 2025`,
    // Israeli food/lifestyle early signals
    `${category} ${city} טרנד עולה 2025`,
    `${category} ישראל מגמה חדשה רשתות חברתיות`,
    // Niche early-adopter communities
    `${services || category} Israel micro trend blog forum`,
  ];
}

// ── Main agent ─────────────────────────────────────────────────────────────────
export async function detectEarlyTrends(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city, relevant_services = '' } = profile;

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
    ].filter(Boolean).join('\n\n');

    // ── 5. AI analysis — pre-peak trend scoring ─────────────────────────────
    const result = await invokeLLM({
      prompt: `אתה אנליסט מגמות מתמחה בגילוי טרנדים לפני שהם מגיעים לפיק שלהם.
המשימה: מצא 2-5 טרנדים שנמצאים עדיין ב-"stage ראשוני" — לא עוד mainstream — אך מראים סימני צמיחה מהירה.

עסק: "${name}" — ${category} ב${city}
שירותים: ${relevant_services || 'לא צוינו'}

נתונים:
${fullContext.slice(0, 3500)}

הוראות חשובות:
• כלול רק טרנדים שיש להם ראיות ספציפיות בנתונים לעיל
• דחה טרנדים שכבר mainstream (כולם מדברים עליהם = מאוחר מדי)
• העדף: velocity גבוה + volume נמוך = זהב
• חשוב: כמה ימים עד שהטרנד יגיע לפיק? (טווח: 7-60 ימים)
• opportunity_text — מה העסק צריך לעשות עכשיו, ספציפי ממש

JSON בלבד:
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
  "confidence": 50-95
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawTrends: any[] = result?.trends || [];

    // Filter: only truly early-stage with evidence
    const earlyTrends = rawTrends.filter(t =>
      t.evidence &&
      t.name &&
      ['emerging', 'early_growing'].includes(t.stage) &&
      t.relevance_to_business !== 'low'
    );

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
