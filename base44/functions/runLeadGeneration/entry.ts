import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import {
  readEpisodes, readMessages, readPromptScores,
  buildEpisodeUpdate, buildPromptScoreUpdate, markMessagesActedOn,
  parseMessages,
  Episode, AgentMessage,
} from '../_shared/agentMemory.ts';

const AGENT_NAME = 'המסנן';

function calculateLeadScore(extraction: any, businessCity: string, winnerDNA?: any) {
  let score = 0;
  // Base score for having intent
  score += 25;
  // Urgency
  const urgencyMap: Record<string, number> = { 'היום': 25, 'today': 25, 'השבוע': 15, 'this_week': 15, 'החודש': 8, 'this_month': 8 };
  score += urgencyMap[extraction.urgency] || 0;
  // Budget mentioned
  if (extraction.budget_range && extraction.budget_range.length > 0) score += 15;
  // City match
  if (businessCity && extraction.city && extraction.city === businessCity) score += 20;
  // Service specified
  if (extraction.service_needed && extraction.service_needed.length > 0) score += 15;

  // ML boost — winner DNA match
  if (winnerDNA) {
    const topSources: string[] = winnerDNA.top_sources || [];
    const topServices: string[] = winnerDNA.top_services || [];
    const topIntent: string[] = winnerDNA.common_intent || [];
    if (extraction.source && topSources[0] && extraction.source === topSources[0]) score += 8;
    if (extraction.service_needed && topServices[0] && extraction.service_needed === topServices[0]) score += 7;
    if (extraction.intent_strength && topIntent[0] && extraction.intent_strength === topIntent[0]) score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

function getStatus(score: number) {
  if (score >= 80) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();
  let profile: any;

  if (body.businessProfileId) {
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: body.businessProfileId });
    profile = profiles[0];
  }

  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) { /* automation mode */ }
  }

  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }

  if (!profile) return Response.json({ error: 'No business profile', leads_generated: 0 }, { status: 404 });

  const { name, category, city } = profile;

  // Load ML winner DNA + episodic memory from SectorKnowledge
  let winnerDNA: any = null;
  let sk: any = null;
  try {
    const skAll = await base44.asServiceRole.entities.SectorKnowledge.filter({});
    sk = skAll.find((s: any) => s.linked_business === profile.id || s.sector === profile.category) || null;
    if (sk?.winner_lead_dna) {
      winnerDNA = JSON.parse(sk.winner_lead_dna);
    }
  } catch (_) {}

  // Read episodic memory and messages
  const pastEpisodes = readEpisodes(sk);
  const incomingMessages = readMessages(sk, AGENT_NAME);

  const memoryContext = pastEpisodes.length > 0 ? `
From previous runs: ${pastEpisodes.slice(0, 3).map((e: Episode) =>
  `${e.agent} found: ${e.key_findings.slice(0, 2).join(', ')}`
).join(' | ')}
` : '';

  const messageContext = incomingMessages.length > 0 ? `
PRIORITY signals from other agents:
${incomingMessages.filter((m: AgentMessage) => m.priority === 'critical' || m.priority === 'high').map((m: AgentMessage) =>
  `[${m.priority}] ${m.from_agent}: ${m.subject} — ${m.body}`
).join('\n')}
` : '';

  // קרא RawSignals אמיתיים שנאספו על ידי Tavily
  const rawSignals = await base44.asServiceRole.entities.RawSignal.filter(
    { linked_business: profile.id }, '-detected_at', 100
  );

  // סנן רק אותות עם כוונת קנייה פוטנציאלית
  const intentKeywords = [
    'מחפש', 'מחפשת', 'ממליצים', 'מי יודע', 'מי מכיר', 'צריך', 'צריכה',
    'רוצה', 'איפה', 'כמה עולה', 'מחיר', 'הצעת מחיר', 'recommendations',
    'looking for', 'need', 'anyone know', 'מחפשים', 'ממליץ', 'ממליצה'
  ];

  const intentSignals = rawSignals.filter((s: any) => {
    const content = (s.content || '').toLowerCase();
    // רק URLs אמיתיים מ-Tavily (לא ממומצאים)
    const hasRealUrl = s.url && s.url.startsWith('http') && s.source_origin !== 'llm';
    const hasIntent = intentKeywords.some(kw => content.includes(kw));
    return hasIntent && (hasRealUrl || s.source_origin === 'tavily' || s.source === undefined);
  });

  if (intentSignals.length === 0) {
    console.log('runLeadGeneration: אין RawSignals עם כוונת קנייה — לא נוצרו לידים. יש להריץ collectWebSignals קודם.');
    return Response.json({
      leads_generated: 0, hot_leads: 0, warm_leads: 0, cold_leads: 0,
      duplicates_skipped: 0, message: 'אין אותות כוונת קנייה — הרץ collectWebSignals קודם'
    });
  }

  const existingLeads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id });
  const existingSourceUrls = new Set(existingLeads.map((l: any) => l.source_url).filter(Boolean));

  let leadsGenerated = 0;
  let duplicatesSkipped = 0;
  const hotLeadsCreated: any[] = [];

  for (const signal of intentSignals.slice(0, 15)) {
    // בדוק כפילות לפי source URL
    if (signal.url && existingSourceUrls.has(signal.url)) {
      duplicatesSkipped++;
      continue;
    }

    let extraction: any;
    try {
      // LLM רק לחילוץ מידע מהתוכן האמיתי — לא ליצור מידע חדש
      extraction = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `קטע מידע אמיתי מהאינטרנט: "${signal.content}"
מקור: ${signal.url || 'לא ידוע'}
${messageContext}${memoryContext}
האם זה מכיל כוונת קנייה עבור "${category}" ב"${city}" או סביבתה?
אם כן, חלץ מהטקסט:
- service_needed: מה הם מחפשים (רק אם מוזכר בטקסט)
- urgency: כמה דחוף (היום/השבוע/החודש/מתעניין — לפי הטקסט)
- budget_range: תקציב אם מוזכר בטקסט (ריק אם לא)
- name: שם ראשון אם מוזכר בטקסט (ריק אם לא)
- city: עיר אם מוזכרת בטקסט

אם אין כוונת קנייה ברורה — החזר { "has_intent": false }
אסור להמציא מידע שלא מופיע בטקסט.`,
        response_json_schema: {
          type: 'object',
          properties: {
            has_intent: { type: 'boolean' },
            service_needed: { type: 'string' },
            urgency: { type: 'string' },
            budget_range: { type: 'string' },
            name: { type: 'string' },
            city: { type: 'string' },
          }
        }
      });
    } catch (err) {
      console.error('LLM extraction error:', err.message);
      continue;
    }

    if (!extraction?.has_intent) continue;

    const score = calculateLeadScore({ ...extraction, city: extraction.city || city }, city, winnerDNA);
    const status = getStatus(score);

    const newLead = await base44.asServiceRole.entities.Lead.create({
      name: extraction.name || 'ליד מהאינטרנט',
      source: signal.platform || 'web',
      source_url: signal.url || '',           // URL אמיתי מ-Tavily
      source_description: signal.source || '',
      discovery_method: 'tavily_web_search',
      service_needed: extraction.service_needed || '',
      budget_range: extraction.budget_range || '',
      city: extraction.city || city,
      urgency: extraction.urgency || 'מתעניין',
      contact_info: '',                        // אסור למלא אוטומטית — ימולא ידנית או דרך WhatsApp bot
      intent_strength: 'medium',
      intent_source: (signal.content || '').substring(0, 100),
      score,
      status,
      linked_business: profile.id,
      created_at: new Date().toISOString(),
    });

    leadsGenerated++;
    if (signal.url) existingSourceUrls.add(signal.url);
    if (status === 'hot') hotLeadsCreated.push(newLead);
  }

  // צור MarketSignal עבור לידים חמים
  for (const lead of hotLeadsCreated) {
    await base44.asServiceRole.entities.MarketSignal.create({
      summary: `ליד חם נמצא: ${lead.service_needed || category}`,
      impact_level: 'high',
      category: 'opportunity',
      recommended_action: `ליד חם ממתין לטיפול — ${lead.service_needed || ''}`,
      confidence: 75,
      is_read: false,
      detected_at: new Date().toISOString(),
      linked_business: profile.id,
    });
  }

  // === B: WRITE EPISODIC MEMORY ===
  if (sk) {
    try {
      const currentEpisodes = readEpisodes(sk);
      const currentMessages = parseMessages(sk.agent_message_queue || '[]');
      const currentScores = readPromptScores(sk);

      const newEpisode: Episode = {
        agent: AGENT_NAME,
        timestamp: new Date().toISOString(),
        run_summary: `מצאתי ${leadsGenerated} לידים (${hotLeadsCreated.length} חמים) מ-${intentSignals.length} אותות כוונה`,
        key_findings: [
          hotLeadsCreated.length > 0
            ? `${hotLeadsCreated.length} לידים חמים ממקורות: ${[...new Set(hotLeadsCreated.map((l: any) => l.source))].slice(0, 2).join(', ')}`
            : 'אין לידים חמים הריצה הזו',
          `מקורות כוונה: ${[...new Set(intentSignals.map((s: any) => s.platform || s.source_origin))].slice(0, 3).join(', ')}`,
        ].filter(Boolean),
        watch_next: [
          `חפש יותר אותות מ: ${winnerDNA?.top_sources?.[0] || 'web'}`,
          `שירות מבוקש: ${[...new Set(hotLeadsCreated.map((l: any) => l.service_needed).filter(Boolean))].slice(0, 1)[0] || 'לא ידוע'}`,
        ],
        data_quality: intentSignals.length > 5 ? 80 : intentSignals.length > 0 ? 60 : 30,
        signals_count: intentSignals.length,
      };

      const updatedMsgs = markMessagesActedOn(currentMessages, AGENT_NAME);
      const parsedUpdated: AgentMessage[] = (() => { try { return JSON.parse(updatedMsgs); } catch { return []; } })();

      await base44.asServiceRole.entities.SectorKnowledge.update(sk.id, {
        agent_episodic_memory: buildEpisodeUpdate(currentEpisodes, newEpisode),
        agent_message_queue: JSON.stringify(parsedUpdated),
        agent_prompt_scores: buildPromptScoreUpdate(currentScores, AGENT_NAME, newEpisode.data_quality),
      });
    } catch (_) {}
  }

  console.log(`runLeadGeneration: ${leadsGenerated} לידים מ-${intentSignals.length} אותות כוונה, ${duplicatesSkipped} כפולים`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runLeadGeneration',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: leadsGenerated,
      linked_business: profile.id,
    });
  } catch (_) {}

  return Response.json({
    leads_generated: leadsGenerated,
    hot_leads: hotLeadsCreated.length,
    warm_leads: leadsGenerated - hotLeadsCreated.length,
    cold_leads: 0,
    duplicates_skipped: duplicatesSkipped,
    intent_signals_found: intentSignals.length,
  });
});
