import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const SERP_API_KEY   = process.env.SERP_API_KEY   || '';

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'advanced', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

/**
 * Fetch Google Trends growth for a keyword via SerpAPI.
 * Returns null if no key or call fails.
 * Returns { rising: bool, growth: number (%) } otherwise.
 */
async function fetchGoogleTrends(keyword: string): Promise<{ rising: boolean; growth: number } | null> {
  if (!SERP_API_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', keyword);
    url.searchParams.set('geo', 'IL');
    url.searchParams.set('date', 'now 7-d');
    url.searchParams.set('api_key', SERP_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data: any = await res.json();
    const timeline: any[] = data?.interest_over_time?.timeline_data || [];
    if (timeline.length < 4) return null;

    const extractVal = (d: any) => d?.values?.[0]?.extracted_value ?? 0;
    const first3 = timeline.slice(0, 3).map(extractVal);
    const last3  = timeline.slice(-3).map(extractVal);
    const avgFirst = first3.reduce((a: number, b: number) => a + b, 0) / 3;
    const avgLast  = last3.reduce((a: number, b: number) => a + b, 0)  / 3;
    if (avgFirst === 0) return null;

    const growth = ((avgLast - avgFirst) / avgFirst) * 100;
    return { rising: growth >= 30, growth: Math.round(growth) };
  } catch { return null; }
}

export async function detectTrends(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    // -- Web search for trend signals -----------------------------------------
    const searchQueries = [
      `${category} ${city} מגמות 2025`,
      `${category} ביקוש עולה ישראל`,
      `${category} טרנד רשתות חברתיות`,
      `${category} ${city} חדשות שוק`,
      `${category} ${city} עסקים חדשים`,
      `${category} העדפות לקוחות שינויים`,
    ];

    const searchResults = await Promise.all(searchQueries.map(q => tavilySearch(q, 5)));
    const allWebResults = searchResults.flat();

    const seen = new Set<string>();
    const uniqueResults = allWebResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // -- Google Trends via SerpAPI (if key available) -------------------------
    let trendsBlock = '';
    if (SERP_API_KEY) {
      const keywords = [category, `${category} ${city}`, `${category} ישראל`];
      const trendResults = await Promise.all(keywords.map(k => fetchGoogleTrends(k)));
      const rising = trendResults
        .map((t, i) => ({ keyword: keywords[i], data: t }))
        .filter(x => x.data !== null && x.data!.growth > 0);

      if (rising.length > 0) {
        trendsBlock = '\n\n=== GOOGLE TRENDS DATA (7 days) ===\n' +
          rising.map(x => `"${x.keyword}": ${x.data!.growth > 0 ? '+' : ''}${x.data!.growth}% (${x.data!.rising ? 'EARLY TREND — 30%+ rise' : 'moderate'})`).join('\n');
      }
    }

    // -- DB signals context ---------------------------------------------------
    const rawSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      take: 50,
    });

    const webContext = uniqueResults.slice(0, 12)
      .map(r => `[${r.url}]\n${(r.content || r.title || '').substring(0, 300)}`)
      .join('\n---\n');
    const signalContext = rawSignals.slice(0, 20)
      .map(s => `[${s.signal_type}] ${(s.content || '').substring(0, 200)}`)
      .join('\n---\n');

    const combinedContext = `=== WEB RESULTS ===\n${webContext}${trendsBlock}\n\n=== DB SIGNALS ===\n${signalContext}`;

    // -- LLM analysis ---------------------------------------------------------
    const result = await invokeLLM({
      prompt: `אתה אנליסט מגמות שוק לעסקים קטנים בישראל. נתח רק נתונים אמיתיים.

עסק: ${name}, ${category}, ${city}

נתונים:
${combinedContext.substring(0, 3500)}

זהה 2-4 מגמות טרום-מיינסטרים עם ראיות מהנתונים בלבד.
חוק: כלול רק מגמות עם ראיות ספציפיות. דלג על מגמות ללא אסמכתא.

החזר JSON:
{"trends":[{
  "trend_name":"שם קצר בעברית",
  "description":"משפט אחד בעברית — עד 12 מילה",
  "evidence":"ציטוט ספציפי או URL מהנתונים",
  "growth_stage":"emerging|growing|mainstream",
  "relevance_to_business":"high|medium|low",
  "urgency":"high|medium|low",
  "estimated_days_until_peak":30,
  "action_platform":"instagram|facebook|google_ads|content|whatsapp",
  "opportunity_for_business":"פועל + יעד — עד 6 מילים",
  "confidence":60-90,
  "source_type":"web|signal|both"
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawTrends: any[] = result?.trends || [];
    // Filter out low-relevance trends
    const trends = rawTrends.filter(t => t.relevance_to_business !== 'low');

    const existingSignals = await prisma.marketSignal.findMany({ where: { linked_business: businessProfileId } });
    const existingSummaries = new Set(existingSignals.map(s => s.summary));

    let created = 0;
    for (const trend of trends) {
      if (!trend.evidence) continue;
      if (!trend.trend_name || existingSummaries.has(trend.trend_name)) continue;

      // Boost impact for early trends (30%+ rise from Google Trends)
      const isEarlyTrend = trend.urgency === 'high' || trend.growth_stage === 'emerging';

      // Build a concise action — one sentence + platform hint, no raw evidence dump
      const action = [
        trend.opportunity_for_business || trend.trend_name,
        trend.action_platform ? `(${trend.action_platform})` : '',
      ].filter(Boolean).join(' ').slice(0, 120);

      await prisma.marketSignal.create({
        data: {
          summary: trend.trend_name,
          impact_level: isEarlyTrend ? 'high' : 'medium',
          category: 'trend',
          recommended_action: action,
          confidence: trend.confidence || 70,
          source_urls: '',
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
      existingSummaries.add(trend.trend_name);
      created++;
    }

    // Update SectorKnowledge if new trends found
    if (created > 0) {
      try {
        const sectorRecord = await prisma.sectorKnowledge.findFirst({ where: { sector: category } });
        if (sectorRecord) {
          const trendNames = trends.filter(t => t.evidence).map((t: any) => t.trend_name).join(', ');
          await prisma.sectorKnowledge.update({
            where: { id: sectorRecord.id },
            data: { trending_services: trendNames, last_updated: new Date().toISOString() },
          });
        }
      } catch (_) {}
    }

    await writeAutomationLog('detectTrends', businessProfileId, startTime, created);
    return res.json({
      trends_created: created,
      web_results_analyzed: uniqueResults.length,
      google_trends_used: !!SERP_API_KEY,
      early_trends: trends.filter(t => t.urgency === 'high').length,
    });
  } catch (err: any) {
    console.error('detectTrends error:', err.message);
    await writeAutomationLog('detectTrends', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
