import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

// Intent scoring — used for lead scoring bonus only (not as a gate)
const INTENT_KEYWORDS_HE = ['מחפש', 'מחפשת', 'צריך', 'צריכה', 'ממליצים', 'המלצה', 'מישהו מכיר', 'יש מישהו', 'אפשר להמליץ', 'בדחיפות', 'הצעת מחיר', 'מחיר', 'כמה עולה'];
const INTENT_KEYWORDS_EN = ['looking for', 'recommend', 'anyone know', 'need a', 'searching for', 'can someone', 'help me find', 'price', 'quote', 'hire'];

function countIntent(text: string): number {
  const lower = text.toLowerCase();
  const heMatches = INTENT_KEYWORDS_HE.filter(kw => lower.includes(kw)).length;
  const enMatches = INTENT_KEYWORDS_EN.filter(kw => lower.includes(kw)).length;
  return heMatches + enMatches;
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

    // Load learned business context for personalized messaging
    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || 'professional';
    const toneInstruction = tone === 'casual'
      ? 'טון קליל וחברותי, עם אמוג\'י אחד לכל היותר'
      : tone === 'warm'
      ? 'טון חם ואישי, מבלי להיות מכירתי'
      : 'טון מקצועי ואמין';

    const existingLeads = await prisma.lead.findMany({
      where: { linked_business: businessProfileId, source_origin: 'tavily' },
      select: { source_url: true },
    });
    const existingUrls = new Set(existingLeads.map(l => l.source_url).filter(Boolean));

    if (isTavilyRateLimited()) {
      await writeAutomationLog('findSocialLeads', businessProfileId, startTime, 0);
      return res.json({ leads_created: 0, note: 'Tavily rate limit reached — upgrade plan' });
    }

    // Keep query count low to preserve Tavily credits (4 queries × 5 results = 20 calls max)
    const queries = [
      `${category} ${city} מחפש המלצה`,
      `"צריך ${category}" OR "מחפש ${category}" ${city}`,
      `${category} ${city} recommendation looking for`,
      `${category} near ${city} need help hire`,
    ];

    let leadsCreated = 0;

    for (const query of queries) {
      if (isTavilyRateLimited()) break;
      const results = await tavilySearch(query, 5);
      for (const r of results) {
        const text = (r.content || r.title || '');
        if (!text || text.length < 30) continue; // skip empty snippets
        if (r.url && existingUrls.has(r.url)) continue;

        // Extract lead details via LLM — extract only, never invent
        let extracted: any = null;
        try {
          extracted = await invokeLLM({
            prompt: `You are a lead qualification expert. Analyze this web content and determine if it represents a REAL PERSON actively looking to hire or buy a service.

TEXT: "${text.substring(0, 600)}"
URL: ${r.url || ''}

Return JSON: {"service_needed":"","urgency":"","budget_mentioned":"","person_name":"","platform":"facebook|instagram|forum|web","is_lead":true}

STRICT RULES — set is_lead=false if ANY of these are true:
- The page is a business directory or list of service providers
- The page is a contractor/business website (they ARE the service provider)
- The page is a news article, blog post, or general information
- The content is a review of a business (not someone seeking one)
- The content is an advertisement
- There is no specific person expressing a need

Only set is_lead=true if there is a REAL PERSON posting something like "I need a contractor", "anyone recommend a plumber?", "looking for renovation help" — a genuine customer inquiry.

Leave string fields as "" if not mentioned.`,
            response_json_schema: { type: 'object' },
            model: 'haiku',
          });
        } catch (_) {}

        if (!extracted || !extracted.is_lead) continue;

        // Generate Hebrew WhatsApp first contact message (personalized to business tone)
        let suggestedMessage = '';
        try {
          const msgResult = await invokeLLM({
            prompt: `כתוב הודעת WhatsApp ראשונה בעברית (2-3 שורות) עבור העסק "${name}" (${category} ב${city}).

מה הוא מחפש: ${extracted.service_needed || category}
פוסט מקורי: "${text.substring(0, 250)}"
${extracted.person_name ? `שם הפונה: ${extracted.person_name}` : ''}

הנחיות סגנון: ${toneInstruction}. פתח בשם אם ידוע. הזכר את השירות הספציפי. סיים בהצעה לעזור.
כתוב רק את טקסט ההודעה בלבד.`,
          });
          suggestedMessage = typeof msgResult === 'string' ? msgResult.trim() : '';
        } catch (_) {}

        // Dynamic lead scoring
        let score = 50;
        if (extracted.urgency === 'immediate' || extracted.urgency === 'urgent') score += 25;
        else if (extracted.urgency === 'soon' || extracted.urgency === 'this_week') score += 12;
        if (extracted.budget_mentioned) score += 15;
        if (extracted.person_name) score += 5;
        if ((r.url || '').includes('facebook.com')) score += 5;
        if (text.includes('בדחיפות') || text.includes('מיד')) score += 10;
        const intentMatches = countIntent(text);
        if (intentMatches >= 2) score += 8;
        else if (intentMatches === 1) score += 4;
        score = Math.min(score, 98);

        // Determine action type: 'call' for immediate urgency leads
        const alertActionType = (extracted.urgency === 'immediate' || extracted.urgency === 'urgent')
          ? 'call' : 'social_post';
        const alertActionLabel = alertActionType === 'call'
          ? `התקשר ל${extracted.person_name || 'הליד'}` : `שלח הודעה ל${extracted.person_name || 'הליד'}`;

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
              score,
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

          // Create ProactiveAlert with structured action metadata
          const alertMeta = JSON.stringify({
            action_label:  alertActionLabel,
            action_type:   alertActionType,
            prefilled_text: suggestedMessage || `שלח הודעת WhatsApp ל${extracted.person_name || 'הליד'} בנושא ${extracted.service_needed || category}`,
            urgency_hours: extracted.urgency === 'immediate' ? 2 : 12,
            impact_reason: 'ליד חם — ככל שתגיב מהר יותר, כך גדלים הסיכויים לסגירה',
          });

          await prisma.proactiveAlert.create({
            data: {
              alert_type: 'hot_lead',
              title: `ליד חם: ${extracted.service_needed || category}${extracted.person_name ? ` — ${extracted.person_name}` : ''}`,
              description: text.substring(0, 200),
              suggested_action: suggestedMessage || `צור קשר עם הליד`,
              priority: score >= 80 ? 'high' : 'medium',
              source_agent: alertMeta,
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
