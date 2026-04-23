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

const INTENT_KEYWORDS_HE = ['מחפש', 'מחפשת', 'צריך', 'צריכה', 'ממליצים', 'המלצה', 'מישהו מכיר', 'יש מישהו', 'אפשר להמליץ', 'בדחיפות', 'הצעת מחיר', 'מחיר', 'כמה עולה'];
const INTENT_KEYWORDS_EN = ['looking for', 'recommend', 'anyone know', 'need a', 'searching for', 'can someone', 'help me find'];

function hasIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return INTENT_KEYWORDS_HE.some(kw => lower.includes(kw)) || INTENT_KEYWORDS_EN.some(kw => lower.includes(kw));
}

export async function findSocialLeads(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    const existingLeads = await prisma.lead.findMany({
      where: { linked_business: businessProfileId, source_origin: 'tavily' },
      select: { source_url: true },
    });
    const existingUrls = new Set(existingLeads.map(l => l.source_url).filter(Boolean));

    const queries = [
      `${category} ${city} מחפש ממליצים פייסבוק`,
      `"מחפש ${category}" ${city} קבוצה`,
      `${category} ${city} מישהו מכיר המלצה`,
      `${category} ${city} site:facebook.com`,
      `"צריך ${category}" OR "מחפש ${category}" ${city}`,
      `${category} ${city} פורום המלצה`,
      `${category} ${city} instagram`,
      `${category} אזור ${city} הצעת מחיר`,
    ];

    let leadsCreated = 0;

    for (const query of queries) {
      const results = await tavilySearch(query, 5);
      for (const r of results) {
        const text = (r.content || r.title || '');
        if (!hasIntent(text)) continue;
        if (r.url && existingUrls.has(r.url)) continue;

        // Extract lead details via LLM — extract only, never invent
        let extracted: any = null;
        try {
          extracted = await invokeLLM({
            prompt: `Extract lead information from this text. Only extract what is EXPLICITLY stated — do NOT invent or assume.

TEXT: "${text.substring(0, 600)}"
URL: ${r.url || ''}

Return JSON: {"service_needed":"","urgency":"","budget_mentioned":"","person_name":"","platform":"facebook|instagram|forum|web","is_lead":true}
Set is_lead=false if no clear intent to purchase/hire a service. Leave fields as "" if not mentioned.`,
            response_json_schema: { type: 'object' },
          });
        } catch (_) {}

        if (!extracted || !extracted.is_lead) continue;

        // Generate Hebrew WhatsApp first contact message
        let suggestedMessage = '';
        try {
          const msgResult = await invokeLLM({
            prompt: `כתוב הודעת WhatsApp ראשונה טבעית בעברית (2-3 שורות) עבור העסק "${name}" (${category} ב${city}) בתגובה לאדם שמחפש שירות.

מה הוא מחפש: ${extracted.service_needed || category}
פוסט מקורי: "${text.substring(0, 250)}"

כללים: טון טבעי ולא מכירתי. פתח בברכה. הזכר את השירות בקצרה. סיים בהצעת עזרה.
כתוב רק את טקסט ההודעה בלבד.`,
          });
          suggestedMessage = typeof msgResult === 'string' ? msgResult.trim() : '';
        } catch (_) {}

        try {
          await prisma.lead.create({
            data: {
              name: extracted.person_name || 'ליד מסושיאל',
              source: extracted.platform || 'social_search',
              source_url: r.url || null,
              source_origin: 'tavily',
              discovery_method: 'social_search',
              service_needed: extracted.service_needed || category,
              urgency: extracted.urgency || 'this_week',
              budget_range: extracted.budget_mentioned || null,
              status: 'hot',
              score: 80,
              freshness_score: 100,
              discovered_at: new Date().toISOString(),
              lifecycle_stage: 'new',
              linked_business: businessProfileId,
              suggested_first_message: suggestedMessage || null,
              created_at: new Date().toISOString(),
            },
          });

          if (r.url) existingUrls.add(r.url);
          leadsCreated++;

          // Create ProactiveAlert
          await prisma.proactiveAlert.create({
            data: {
              alert_type: 'opportunity',
              title: `ליד חדש מסושיאל: ${extracted.service_needed || category}`,
              description: text.substring(0, 200),
              suggested_action: suggestedMessage || `צור קשר עם הליד`,
              priority: 'high',
              source_agent: 'findSocialLeads',
              linked_business: businessProfileId,
              created_at: new Date().toISOString(),
            },
          });
        } catch (_) {}
      }
    }

    await writeAutomationLog('findSocialLeads', businessProfileId, startTime, leadsCreated);
    console.log(`findSocialLeads done: ${leadsCreated} leads created`);
    return res.json({ leads_created: leadsCreated });
  } catch (err: any) {
    console.error('findSocialLeads error:', err.message);
    await writeAutomationLog('findSocialLeads', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
