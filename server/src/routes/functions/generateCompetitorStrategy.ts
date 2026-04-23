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
    const result: any = await callAIJson('competitor_analysis', `אתה יועץ אסטרטגיה עסקית לעסקים קטנים בישראל.

העסק שלנו: "${bp.name}" | תחום: ${bp.category} | עיר: ${bp.city}
מתחרה: "${competitor.name}" | דירוג: ${competitor.rating || '?'}/5 | ביקורות: ${competitor.review_count || '?'}
חוזקות המתחרה: ${competitor.strengths || 'לא ידוע'}
חולשות המתחרה: ${competitor.weaknesses || 'לא ידוע'}
שירותים: ${competitor.services || 'לא ידוע'}
מגמה: ${competitor.trend_direction || '?'}${signalContext}

JSON בלבד — ללא הסברים:
{
  "strategy": "האסטרטגיה הכוללת — עד 20 מילים",
  "moves": [
    {
      "title": "כותרת — עד 5 מילים",
      "reason": "למה עכשיו — משפט אחד",
      "action": "פועל ספציפי — עד 6 מילים",
      "timeframe": "היום|השבוע|החודש",
      "effort": "low|medium|high",
      "platform": "instagram|facebook|in_store|menu|wolt|whatsapp"
    }
  ],
  "tactics": [
    "טקטיקה ספציפית 1 — פועל + מה + זמן מוערך",
    "טקטיקה ספציפית 2 — פועל + מה + זמן מוערך",
    "טקטיקה ספציפית 3 — פועל + מה + זמן מוערך"
  ],
  "timeline": "קצר טווח (שבוע) / בינוני (חודש) / ארוך (רבעון)",
  "key_advantage": "היתרון שלנו מול מתחרה זה — עד 10 מילים",
  "risk": "הסיכון הגדול ביותר — עד 8 מילים",
  "avoid": ["דבר לא לעשות — עד 5 מילים"],
  "monitor": ["מה לעקוב — עד 5 מילים"]
}
חוק: בדיוק 3 moves ובדיוק 3 tactics.`);

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
