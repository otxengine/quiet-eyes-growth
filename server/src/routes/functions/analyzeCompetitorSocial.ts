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
          model: 'haiku',
          prompt: `נתח את הנוכחות הדיגיטלית של המתחרה "${comp.name}".
העסק שלנו: "${profile?.name}" (${profile?.category}, ${profile?.city})

תוכן שנמצא:
${textBlob.slice(0, 2000)}

JSON בלבד:
{
  "content_strategy": "אסטרטגיית תוכן — משפט אחד",
  "strongest_channel": "instagram|facebook|google|unknown",
  "engagement_level": "low|medium|high",
  "content_themes": ["נושא 1", "נושא 2"],
  "our_opportunity": "הזדמנות ספציפית מול הנתונים — עד 20 מילה",
  "recommended_action": "פועל + יעד — עד 8 מילים",
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
