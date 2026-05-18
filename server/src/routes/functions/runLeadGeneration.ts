import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';
import { publishEvent } from '../../lib/eventBus';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

const intentKeywords = [
  'מחפש', 'צריך', 'מישהו יודע', 'מי מכיר', 'המלצה על', 'כמה עולה',
  'איפה אפשר', 'looking for', 'need a', 'recommend', 'price for',
  'anyone know', 'where can i', 'how much', 'seeking', 'want to hire',
];

function calculateLeadScore(
  extraction: any,
  businessCity: string,
  winnerDna: any | null = null
): { score: number; reasoning: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Geography match (20 pts)
  if (businessCity && extraction.city) {
    const cityMatch = extraction.city.trim() === businessCity.trim();
    const geoScore = cityMatch ? 20 : 8;
    score += geoScore;
    reasons.push(cityMatch ? `עיר תואמת (${extraction.city}) +20` : `עיר קרובה +8`);
  }

  // Budget specified (25 pts)
  if (extraction.budget_range && extraction.budget_range.length > 0) {
    score += 25;
    reasons.push(`תקציב מפורש: ${extraction.budget_range} +25`);
  }

  // Service match (20 pts)
  if (extraction.service_needed && extraction.service_needed.length > 0) {
    score += 20;
    reasons.push(`שירות מוגדר: ${extraction.service_needed} +20`);
  }

  // Urgency (15 pts max)
  const urgencyMap: Record<string, number> = {
    'היום': 15, 'today': 15,
    'השבוע': 10, 'this_week': 10,
    'החודש': 5,  'this_month': 5,
  };
  const urgencyScore = urgencyMap[extraction.urgency] ?? 0;
  if (urgencyScore > 0) {
    score += urgencyScore;
    reasons.push(`דחיפות: ${extraction.urgency} +${urgencyScore}`);
  }

  // Source quality (15 pts)
  const sourceScores: Record<string, number> = {
    'google.com/maps': 15, 'facebook.com': 12, 'yad2.co.il': 10, 'reddit': 8,
  };
  const sourceKey = Object.keys(sourceScores).find(k => (extraction.source_url || '').includes(k));
  const sourceScore = sourceKey ? sourceScores[sourceKey] : 5;
  score += sourceScore;
  reasons.push(`מקור: +${sourceScore}`);

  // Intent signal (5 pts)
  if (extraction.has_intent === true) {
    score += 5;
    reasons.push('כוונת קנייה מפורשת +5');
  }

  // Winner DNA bonus (up to +10 bonus, not exceeding 100)
  if (winnerDna) {
    const topServices: string[] = winnerDna.top_services ?? [];
    const topBudgets: string[]  = winnerDna.top_budget_ranges ?? [];
    let dnaBonus = 0;
    if (topServices.some(s => (extraction.service_needed || '').includes(s))) dnaBonus += 5;
    if (topBudgets.some(b => (extraction.budget_range || '').includes(b))) dnaBonus += 5;
    if (dnaBonus > 0) {
      score += dnaBonus;
      reasons.push(`דומה ללידים שנסגרו בעבר +${dnaBonus}`);
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasoning: reasons };
}

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

export async function runLeadGeneration(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city, relevant_services } = profile;
    // Read lead criteria directly from individual profile fields (set via Settings page)
    const leadCriteriaContext = [
      profile.min_budget ? `תקציב מינימלי: ${profile.min_budget}` : '',
      profile.relevant_services ? `שירותים: ${profile.relevant_services}` : '',
      profile.preferred_area ? `אזור: ${profile.preferred_area}` : '',
      (profile as any).lead_intent_signals ? `סימני כוונה: ${(profile as any).lead_intent_signals}` : '',
      (profile as any).lead_quality_notes ? `הערות איכות: ${(profile as any).lead_quality_notes}` : '',
    ].filter(Boolean).join('. ');

    // Load winner DNA to bias scoring toward past closed deals
    const sectorKnowledge = await prisma.sectorKnowledge.findFirst({
      where: { sector: category, region: city },
    });
    const winnerDna = sectorKnowledge?.winner_lead_dna
      ? JSON.parse(sectorKnowledge.winner_lead_dna)
      : null;

    const existingLeads = await prisma.lead.findMany({ where: { linked_business: businessProfileId } });
    const existingUrls = new Set(existingLeads.map(l => l.source_url).filter(Boolean));

    // Phase 1: collect raw signals with intent
    const rawSignals = await prisma.rawSignal.findMany({
      where: { linked_business: businessProfileId, source_origin: 'tavily' },
      orderBy: { created_date: 'desc' },
      take: 100,
    });

    const intentSignals = rawSignals.filter(s => {
      const content = (s.content || '').toLowerCase();
      return intentKeywords.some(kw => content.includes(kw.toLowerCase()));
    }).filter(s => !existingUrls.has(s.url || ''));

    let newLeads = 0;

    for (const signal of intentSignals.slice(0, 10)) {
      try {
        const extraction = await invokeLLM({
          prompt: `The following text was collected from the internet:
URL: ${signal.url}
Content: "${(signal.content || '').substring(0, 400)}"

Does this indicate that someone is looking for a "${category}" service in the "${city}" area in Israel?
${leadCriteriaContext ? `Lead criteria for this business: ${leadCriteriaContext}.` : ''}
If yes, extract ONLY from the text (do not invent):
- name: the person's name if mentioned, otherwise "לקוח פוטנציאלי"
- service_needed: the service being sought (up to 5 words)
- city: city if mentioned
- urgency: היום/השבוע/החודש/מתעניין
- budget_range: budget if mentioned
- has_intent: true/false

If there is no clear purchase intent — return { "has_intent": false }

Return ONLY valid JSON. ALL string values must be in Hebrew.`,
          response_json_schema: { type: 'object' },
        });

        if (!extraction?.has_intent || extraction.has_intent === false) continue;

        const { score, reasoning } = calculateLeadScore(extraction, city, winnerDna);
        if (score < 25) continue;

        const now = new Date().toISOString();
        await prisma.lead.create({
          data: {
            name: extraction.name || 'לקוח פוטנציאלי',
            source: signal.source || 'חיפוש אינטרנט',
            score,
            status: score >= 80 ? 'hot' : score >= 40 ? 'warm' : 'cold',
            service_needed: extraction.service_needed || category,
            city: extraction.city || city,
            urgency: extraction.urgency,
            budget_range: extraction.budget_range,
            source_url: signal.url,
            source_origin: 'tavily',
            discovery_method: 'tavily_web_search',
            lifecycle_stage: 'new',
            created_at: now,
            discovered_at: now,
            freshness_score: 100,
            followup_count: 0,
            score_reasoning: reasoning.join(' | '),
            linked_business: businessProfileId,
          },
        });

        newLeads++;
        existingUrls.add(signal.url || '');
      } catch (err: any) {
        console.error('Lead extraction error:', err.message);
      }
    }

    // Phase 2: Tavily search if no raw signals yet
    if (intentSignals.length === 0 && TAVILY_API_KEY) {
      const queries = [
        `מחפש ${category} ${city}`,
        `צריך ${relevant_services || category} ${city}`,
        `המלצה על ${category} ${city}`,
      ];
      for (const query of queries) {
        const results = await tavilySearch(query, 5);
        for (const result of results) {
          if (!result.url || existingUrls.has(result.url)) continue;
          const content = result.content || result.title || '';
          if (!intentKeywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()))) continue;

          await prisma.rawSignal.create({
            data: {
              source: `tavily: ${query}`,
              content: content.substring(0, 500),
              url: result.url,
              signal_type: 'web_search',
              source_origin: 'tavily',
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          });
        }
      }
    }

    await writeAutomationLog('runLeadGeneration', businessProfileId, startTime, newLeads);

    // OTX-001: publish hot_lead events for each new hot lead found
    if (newLeads > 0) {
      const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId }, select: { category: true, city: true } });
      const hotLeads = await prisma.lead.findMany({
        where: { linked_business: businessProfileId, status: 'hot' },
        orderBy: { created_date: 'desc' },
        take: newLeads,
        select: { id: true, name: true, score: true, service_needed: true },
      });
      for (const lead of hotLeads) {
        publishEvent({
          businessId: businessProfileId,
          eventType: 'hot_lead',
          source: 'runLeadGeneration',
          payload: { leadId: lead.id, name: lead.name, score: lead.score, service: lead.service_needed },
          contextAttrs: { category: profile?.category, city: profile?.city, impact: 'high' },
        }).catch(() => {});
      }
    }

    console.log(`runLeadGeneration done: ${newLeads} leads from ${intentSignals.length} signals`);
    return res.json({ new_leads: newLeads, signals_checked: intentSignals.length });
  } catch (err: any) {
    console.error('runLeadGeneration error:', err.message);
    await writeAutomationLog('runLeadGeneration', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
