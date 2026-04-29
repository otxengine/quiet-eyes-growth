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
    const leadCriteria = (profile as any).lead_criteria
      ? JSON.parse((profile as any).lead_criteria)
      : {};
    const minBudget = leadCriteria.min_budget || '';
    const relevantServices = leadCriteria.relevant_services || '';
    const preferredArea = leadCriteria.preferred_area || city;
    const intentSignals = leadCriteria.lead_intent_signals || '';
    const qualityNotes = leadCriteria.lead_quality_notes || '';
    const leadCriteriaContext = [
      minBudget ? `תקציב מינימלי: ${minBudget}` : '',
      relevantServices ? `שירותים רלוונטיים: ${relevantServices}` : '',
      preferredArea ? `אזור: ${preferredArea}` : '',
      intentSignals ? `סימני כוונה: ${intentSignals}` : '',
      qualityNotes ? `הערות: ${qualityNotes}` : '',
    ].filter(Boolean).join('. ');

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

    // 6 queries — 2 extra using lead criteria context
    const queries = [
      `${category} ${city} מחפש המלצה`,
      `"צריך ${category}" OR "מחפש ${category}" ${city}`,
      `${category} ${city} recommendation looking for`,
      `${category} near ${city} need help hire`,
      `"${relevantServices || category}" ${preferredArea} מחפש`,
      `"${relevantServices || category}" ${preferredArea} recommendation`,
    ];

    let leadsCreated = 0;

    // ── Collect all Tavily results first, then batch-qualify ────────────────
    const candidates: Array<{ text: string; url: string }> = [];
    for (const query of queries) {
      if (isTavilyRateLimited()) break;
      const results = await tavilySearch(query, 5);
      for (const r of results) {
        const text = (r.content || r.title || '');
        if (!text || text.length < 30) continue;
        if (r.url && existingUrls.has(r.url)) continue;
        // Deduplicate within batch
        if (candidates.some(c => c.url === r.url)) continue;
        candidates.push({ text, url: r.url || '' });
      }
    }

    // Batch-qualify in chunks of 8 (one Haiku call per chunk)
    const qualified: Array<{ text: string; url: string; extracted: any }> = [];
    const CHUNK = 8;
    for (let ci = 0; ci < candidates.length; ci += CHUNK) {
      const chunk = candidates.slice(ci, ci + CHUNK);
      const itemsStr = chunk
        .map((c, i) => `[${i}] URL:${c.url}\n"${c.text.substring(0, 400)}"`)
        .join('\n---\n');
      try {
        const batchResult = await invokeLLM({
          prompt: `You are a lead qualification expert for the Israeli business "${name}" (${category}, ${city}).
${leadCriteriaContext ? `Business wants leads matching: ${leadCriteriaContext}.` : ''}

For each item determine if it represents a REAL PERSON actively looking to hire/buy a service (not a business, directory, article, ad, or review).

${itemsStr}

Return JSON only: {"results":[{"is_lead":true,"service_needed":"","urgency":"","budget_mentioned":"","person_name":"","platform":"facebook|instagram|forum|web","score_reasoning":"one sentence why this is/isn't a good lead"},...]}, same length and order.

Set is_lead=false if: business directory, contractor site, news/blog, business review, advertisement, no specific person expressing a need.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1200,
        });
        const results: any[] = batchResult?.results || [];
        for (let i = 0; i < chunk.length; i++) {
          const extracted = results[i];
          if (extracted?.is_lead) {
            qualified.push({ text: chunk[i].text, url: chunk[i].url, extracted });
          }
        }
      } catch (_) {}
    }

    // ── Generate messages in batch for all qualified leads ───────────────────
    const messagesArr: string[] = [];
    if (qualified.length > 0) {
      const msgItemsStr = qualified
        .map((q, i) => `[${i}] שירות: ${q.extracted.service_needed || category} | שם: ${q.extracted.person_name || ''} | פוסט: "${q.text.substring(0, 200)}"`)
        .join('\n');
      try {
        const batchMsg = await invokeLLM({
          prompt: `כתוב הודעת WhatsApp ראשונה בעברית (2-3 שורות) עבור העסק "${name}" (${category} ב${city}). ${toneInstruction}. פתח בשם אם ידוע. הזכר שירות ספציפי. סיים בהצעה לעזור.

${msgItemsStr}

JSON בלבד: {"messages":["הודעה0","הודעה1",...]}, אותו אורך ואותו סדר.`,
          response_json_schema: { type: 'object' },
          model: 'haiku',
          maxTokens: 1500,
        });
        const msgs: string[] = batchMsg?.messages || [];
        for (let i = 0; i < qualified.length; i++) messagesArr[i] = msgs[i] || '';
      } catch (_) {}
    }

    // ── Save qualified leads ─────────────────────────────────────────────────
    for (let qi = 0; qi < qualified.length; qi++) {
      const { text, url, extracted } = qualified[qi];
      const suggestedMessage = messagesArr[qi] || '';

      // Dynamic lead scoring
      let score = 25;
      if (extracted.urgency === 'immediate' || extracted.urgency === 'urgent') score += 25;
      else if (extracted.urgency === 'soon' || extracted.urgency === 'this_week') score += 12;
      if (extracted.budget_mentioned) score += 15;
      if (extracted.person_name) score += 5;
      if (url.includes('facebook.com')) score += 5;
      if (text.includes('בדחיפות') || text.includes('מיד')) score += 10;
      const intentMatches = countIntent(text);
      if (intentMatches >= 2) score += 8;
      else if (intentMatches === 1) score += 4;
      score = Math.min(score, 98);
      if (score < 35) continue; // skip low-confidence leads entirely

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
            source_url: url || null,
            source_origin: 'tavily',
            discovery_method: 'social_search',
            service_needed: extracted.service_needed || category,
            urgency: extracted.urgency || 'this_week',
            budget_range: extracted.budget_mentioned || null,
            status: score >= 75 ? 'hot' : score >= 55 ? 'warm' : 'new',
            score,
            score_reasoning: extracted.score_reasoning || null,
            freshness_score: 100,
            discovered_at: new Date().toISOString(),
            lifecycle_stage: 'new',
            linked_business: businessProfileId,
            suggested_first_message: suggestedMessage || null,
            created_at: new Date().toISOString(),
          },
        });

        if (url) existingUrls.add(url);
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

    await writeAutomationLog('findSocialLeads', businessProfileId, startTime, leadsCreated);
    console.log(`findSocialLeads done: ${leadsCreated} leads created`);
    return res.json({ leads_created: leadsCreated });
  } catch (err: any) {
    console.error('findSocialLeads error:', err.message);
    await writeAutomationLog('findSocialLeads', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
