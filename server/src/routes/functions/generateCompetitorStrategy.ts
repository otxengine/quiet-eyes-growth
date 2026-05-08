import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { callAIJson } from '../../lib/ai_router';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 3): Promise<any[]> {
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
 * generateCompetitorStrategy
 * Produces a focused counter-strategy (3 moves) for a single competitor.
 * When no recent signals exist, runs a quick bootstrap web search.
 *
 * Body: { competitorId, businessProfileId }
 * Returns: { strategy, moves, tactics, timeline, key_advantage, risk }
 */
export async function generateCompetitorStrategy(req: Request, res: Response) {
  const { competitorId, businessProfileId } = req.body;
  if (!competitorId) return res.status(400).json({ error: 'Missing competitorId' });

  try {
    const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    const bpId = businessProfileId || competitor.linked_business;
    const bp   = await prisma.businessProfile.findFirst({ where: { id: bpId } });
    if (!bp) return res.status(404).json({ error: 'Business profile not found' });

    // Pull recent competitor_move signals
    const recentSignals = await prisma.marketSignal.findMany({
      where: { linked_business: bpId, category: 'competitor_move' },
      orderBy: { detected_at: 'desc' },
      take: 10,
    });

    // Filter to signals mentioning this competitor
    const competitorSignals = recentSignals.filter(s =>
      s.summary?.includes(competitor.name) || s.recommended_action?.includes(competitor.name),
    );

    // Bootstrap: if no signals for this competitor, do a quick web search
    let bootstrapContext = '';
    if (competitorSignals.length === 0) {
      const bootstrapResults = await tavilySearch(
        `"${competitor.name}" ${bp.city} מחיר ביקורות שירות מבצע`, 4,
      );
      if (bootstrapResults.length > 0) {
        bootstrapContext = '\n\nנתוני bootstrap מהרשת:\n' +
          bootstrapResults
            .map(r => `[${r.url}] ${r.title} — ${(r.content || '').slice(0, 200)}`)
            .join('\n');
      }
    }

    const signalContext = competitorSignals.length > 0
      ? `\n\nאותות עדכניים אצל המתחרה:\n${competitorSignals.map(s => `• ${s.summary}`).join('\n')}`
      : bootstrapContext || '\n\nאין נתונים ספציפיים — ניתוח מבוסס פרופיל כללי.';

    // Use callAIJson with competitor_analysis task (Claude Sonnet — strategic depth)
    const result: any = await callAIJson('competitor_analysis', `You are a business strategy advisor for small businesses in Israel.

Our business: "${bp.name}" | Category: ${bp.category} | City: ${bp.city}
Competitor: "${competitor.name}" | Rating: ${competitor.rating || '?'}/5 | Reviews: ${competitor.review_count || '?'}
Competitor strengths: ${competitor.strengths || 'unknown'}
Competitor weaknesses: ${competitor.weaknesses || 'unknown'}
Services: ${competitor.services || 'unknown'}
Trend: ${competitor.trend_direction || '?'}${signalContext}

Return ONLY valid JSON. ALL string values must be in Hebrew. No explanations outside the JSON:
{
  "strategy": "overall strategy — up to 20 words",
  "moves": [
    {
      "title": "title — up to 5 words",
      "reason": "why now — one sentence",
      "action": "specific action verb — up to 6 words",
      "timeframe": "today|this_week|this_month",
      "effort": "low|medium|high",
      "platform": "instagram|facebook|in_store|menu|wolt|whatsapp"
    }
  ],
  "tactics": [
    "specific tactic 1 — verb + what + estimated time",
    "specific tactic 2 — verb + what + estimated time",
    "specific tactic 3 — verb + what + estimated time"
  ],
  "timeline": "short-term (week) / medium (month) / long (quarter)",
  "key_advantage": "our advantage over this competitor — up to 10 words",
  "risk": "biggest risk — up to 8 words",
  "avoid": ["thing not to do — up to 5 words"],
  "monitor": ["what to track — up to 5 words"]
}
Rule: exactly 3 moves and exactly 3 tactics.`);

    return res.json(result || {
      strategy: '',
      moves: [],
      tactics: [],
      timeline: '',
      key_advantage: '',
      risk: '',
      avoid: [],
      monitor: [],
    });
  } catch (err: any) {
    console.error('generateCompetitorStrategy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
