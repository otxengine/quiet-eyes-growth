import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 5): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

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

    const insights: any[] = [];

    for (const comp of competitors.slice(0, 5)) { // max 5 to control API usage
      try {
        const socialResults = await Promise.all([
          tavilySearch(`"${comp.name}" site:instagram.com`, 3),
          tavilySearch(`"${comp.name}" site:facebook.com`, 3),
          tavilySearch(`"${comp.name}" ביקורות לקוחות`, 3),
        ]);
        const allResults = socialResults.flat();
        if (allResults.length === 0) continue;

        const textBlob = allResults
          .map(r => `[${r.url}] ${r.title} — ${(r.content || '').slice(0, 200)}`)
          .join('\n\n');

        const analysis = await invokeLLM({
          model: 'sonnet',
          maxTokens: 500,
          prompt: `You are a senior competitive intelligence analyst. Analyze the digital presence of "${comp.name}" and identify the vulnerability that my business can exploit.

My business: "${profile?.name}" | Sector: ${profile?.category} | City: ${profile?.city}
Competitor: "${comp.name}"

Web findings:
${textBlob.slice(0, 2500)}

Required analysis:
- What is their dominant channel? What do they do well?
- What is the most glaring weakness visible from the content?
- What are customers complaining about? (from reviews)
- What is the most specific opportunity to exploit?

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "content_strategy": "what they do on social — one specific sentence with examples",
  "strongest_channel": "instagram|facebook|google|tiktok|unknown",
  "engagement_level": "low|medium|high",
  "content_themes": ["specific topic 1", "specific topic 2"],
  "main_weakness": "their most glaring weakness — with evidence from data",
  "our_opportunity": "specific focused opportunity — what we can do that they don't",
  "recommended_action": "imperative verb + channel + content — up to 10 words",
  "sentiment_from_reviews": "positive|negative|mixed|unknown"
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (!analysis) continue;

        // Update competitor notes with social insights
        const insightNote = `[ניתוח רשתות ${new Date().toLocaleDateString('he-IL')}] ${analysis.our_opportunity || ''}`;
        await prisma.competitor.update({
          where: { id: comp.id },
          data: { notes: insightNote },
        }).catch(() => {});

        insights.push({ competitor_name: comp.name, ...analysis });
      } catch (_) { /* skip */ }
    }

    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, insights.length);
    return res.json({ analyzed: insights.length, insights });
  } catch (err: any) {
    console.error('[analyzeCompetitorSocial] error:', err.message);
    await writeAutomationLog('analyzeCompetitorSocial', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
