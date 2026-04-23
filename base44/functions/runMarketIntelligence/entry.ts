import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { callClaude, parseClaudeJson } from '../_shared/claudeApi.ts';
import {
  readEpisodes, readMessages, readPromptScores,
  buildEpisodeUpdate, buildMessageUpdate, buildPromptScoreUpdate, markMessagesActedOn,
  parseMessages,
  Episode, AgentMessage,
} from '../_shared/agentMemory.ts';

const AGENT_NAME = 'המנתח';

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
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) {
    return Response.json({ error: 'No business profile found', insights_generated: 0 }, { status: 404 });
  }

  // === B: READ EPISODIC MEMORY ===
  const sectorAll = await base44.asServiceRole.entities.SectorKnowledge.filter({});
  const sectorKnowledge = sectorAll.find((s: any) =>
    s.linked_business === profile.id ||
    (s.sector === profile.category && s.region === profile.city)
  ) || sectorAll.find((s: any) => s.sector === profile.category) || null;

  const pastEpisodes = readEpisodes(sectorKnowledge);
  const incomingMessages = readMessages(sectorKnowledge, AGENT_NAME);
  const promptScores = readPromptScores(sectorKnowledge);
  const myScore = promptScores[AGENT_NAME];

  const memoryContext = pastEpisodes.length > 0 ? `
EPISODIC MEMORY — what I found in recent runs:
${pastEpisodes.slice(0, 5).map((e: Episode) =>
  `[${new Date(e.timestamp).toLocaleDateString('he-IL')}] ${e.agent}: ${e.run_summary}
  Key findings: ${e.key_findings.join(', ')}
  Watching next: ${e.watch_next.join(', ')}`
).join('\n')}
` : '';

  const messageContext = incomingMessages.length > 0 ? `
MESSAGES FROM OTHER AGENTS (act on these first):
${incomingMessages.map((m: AgentMessage) =>
  `[${m.priority.toUpperCase()}] From ${m.from_agent}: ${m.subject}\n  ${m.body}`
).join('\n')}
` : '';

  const improvementContext = myScore?.improvement_notes?.length > 0 ? `
MY PREVIOUS IMPROVEMENT NOTES (apply these):
${myScore.improvement_notes.slice(-3).map((n: string) => `- ${n}`).join('\n')}
Avg quality score so far: ${myScore.avg_quality}/100 over ${myScore.run_count} runs
` : '';

  // === GATHER SIGNALS ===
  const [allRawSignals, competitors] = await Promise.all([
    base44.asServiceRole.entities.RawSignal.filter({ linked_business: profile.id }, '-detected_at', 50),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
  ]);

  const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let signals: any[] = allRawSignals.filter((s: any) => {
    const d = s.detected_at || s.created_date || s.created_at;
    return !d || new Date(d).getTime() >= twoDaysAgo;
  }).slice(0, 20);

  if (signals.length === 0) {
    signals = allRawSignals.filter((s: any) => {
      const d = s.detected_at || s.created_date || s.created_at;
      return !d || new Date(d).getTime() >= weekAgo;
    }).slice(0, 20);
  }
  if (signals.length === 0) signals = allRawSignals.slice(0, 20);
  if (signals.length === 0) {
    return Response.json({ message: 'no raw signals', signals_processed: 0, insights_generated: 0 });
  }

  const competitorContext = competitors.length > 0
    ? `COMPETITORS: ${competitors.slice(0, 5).map((c: any) => `${c.name} (rating:${c.rating || '?'}, trend:${c.trend_direction || '?'})`).join(', ')}`
    : '';

  // Build context block — real content and real URLs from Tavily, each tagged with ID
  const contextBlock = signals.map((s: any) =>
    `[SIGNAL_ID:${s.id}] [${s.signal_type}/${s.platform || 'web'}]
Content: ${(s.content || '').substring(0, 300)}
Source URL: ${s.url || 'no URL'}
Origin: ${s.source_origin || 'tavily'}
---`
  ).join('\n');

  // === C+E: THE UPGRADED PROMPT ===
  const analysisPrompt = `You are an elite market intelligence analyst for Israeli small businesses.
You have episodic memory and learn from your past runs.

BUSINESS: ${profile.name} | ${profile.category} | ${profile.city}
SERVICES: ${profile.relevant_services || 'not specified'}
${competitorContext}
${memoryContext}
${messageContext}
${improvementContext}

CURRENT RAW SIGNALS (${signals.length} total — these are REAL web search results):
${contextBlock}

YOUR ANALYSIS TASK:

1. PRIORITIZE signals flagged in incoming agent messages above
2. USE your episodic memory to detect CHANGES — what's new since last run? What trend is accelerating?
3. For each insight you generate, you MUST provide:
   a. The SIGNAL_IDs (from above) that support it
   b. A direct EXCERPT (max 80 chars) from the signal content that proves it
   c. A REASONING CHAIN in Hebrew: step by step how you got from the signal to the insight
   d. A SELF_SCORE (0-100): how confident you are based purely on evidence quality
   e. WHAT_TO_WATCH: what signal next run would confirm or deny this insight

4. Generate 4-6 insights. For each:
   - summary: Hebrew title (max 60 chars), be specific — use real names and numbers
   - impact_level: high/medium/low
   - category: threat/opportunity/trend/competitor_move/mention
   - recommended_action: specific, actionable, in Hebrew (1-2 sentences)
   - confidence: 50-95 (be honest — lower if evidence is thin)
   - source_signal_ids: array of SIGNAL_IDs from above that prove this
   - source_excerpts: array of 1-3 short quotes (max 80 chars each) from the signal content
   - reasoning_chain: 2-4 step explanation in Hebrew of how you got here
   - self_score: your quality rating for this specific insight (0-100)
   - what_to_watch: what to look for next run to validate (Hebrew, 1 sentence)
   - messages_to_agents: messages to send to other agents
     Each: { to_agent: "agent_name", priority: "critical|high|normal", subject: "...", body: "..." }
     Agent names: "המסנן" (leads), "הצופה" (competitors), "הזיכרון" (memory), "המנקה" (freshness)

5. After generating insights, write your EPISODE SUMMARY:
   - run_summary: 1 sentence what was most notable this run
   - key_findings: 3-5 specific things found
   - watch_next: 3 things to prioritize next run
   - data_quality: 0-100 rating of signal quality this run
   - improvement_note: one thing you'd do differently to generate better insights

Return ONLY valid JSON:
{
  "insights": [...],
  "episode": {
    "run_summary": "...",
    "key_findings": ["..."],
    "watch_next": ["..."],
    "data_quality": 75,
    "improvement_note": "..."
  }
}`;

  let result: any = null;

  // Try Claude first
  try {
    const claudeText = await callClaude(analysisPrompt, {
      systemPrompt: 'You are a market intelligence analyst. Return ONLY valid JSON, no markdown.',
      prefill: '{',
      maxTokens: 3000,
    });
    if (claudeText) {
      result = parseClaudeJson(claudeText, null);
    }
  } catch (_) {}

  // Fall back to Gemini
  if (!result) {
    try {
      result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: analysisPrompt,
        model: 'gemini_3_flash',
        add_context_from_internet: false,
        response_json_schema: {
          type: 'object',
          properties: {
            insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  impact_level: { type: 'string', enum: ['high', 'medium', 'low'] },
                  category: { type: 'string', enum: ['threat', 'opportunity', 'trend', 'competitor_move', 'mention'] },
                  recommended_action: { type: 'string' },
                  confidence: { type: 'number' },
                  source_signal_ids: { type: 'array', items: { type: 'string' } },
                  source_excerpts: { type: 'array', items: { type: 'string' } },
                  reasoning_chain: { type: 'string' },
                  self_score: { type: 'number' },
                  what_to_watch: { type: 'string' },
                  messages_to_agents: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        to_agent: { type: 'string' },
                        priority: { type: 'string' },
                        subject: { type: 'string' },
                        body: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            episode: {
              type: 'object',
              properties: {
                run_summary: { type: 'string' },
                key_findings: { type: 'array', items: { type: 'string' } },
                watch_next: { type: 'array', items: { type: 'string' } },
                data_quality: { type: 'number' },
                improvement_note: { type: 'string' },
              },
            },
          },
        },
      });
    } catch (err: any) {
      console.error('[runMarketIntelligence] LLM failed:', err.message);
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  const insights: any[] = result?.insights || [];
  const episode = result?.episode || null;

  // === SAVE INSIGHTS with full source attribution ===
  const existingSignals = await base44.asServiceRole.entities.MarketSignal.filter({ linked_business: profile.id });
  const existingSummaries = new Set(existingSignals.map((e: any) => e.summary));

  const signalById = new Map(signals.map((s: any) => [s.id, s]));

  let created = 0;
  const outgoingMessages: AgentMessage[] = [];

  for (const insight of insights) {
    if (!insight.summary || existingSummaries.has(insight.summary)) continue;

    const sourceSignalIds: string[] = insight.source_signal_ids || [];
    const sourceSignals = sourceSignalIds
      .map((id: string) => signalById.get(id))
      .filter(Boolean)
      .filter((s: any) => s.source_origin !== 'llm');

    const realUrls = sourceSignals
      .map((s: any) => s.url)
      .filter((u: string) => u && u.startsWith('http'));

    // Fallback keyword URL matching
    if (realUrls.length === 0) {
      const keyWords = insight.summary.split(/\s+/).filter((w: string) => w.length > 3);
      const matchingSignals = signals
        .filter((s: any) => s.url && s.url.startsWith('http') && s.source_origin !== 'llm')
        .filter((s: any) => keyWords.some((kw: string) => (s.content || '').includes(kw)));
      realUrls.push(...matchingSignals.slice(0, 2).map((s: any) => s.url));
    }

    const sourceDescription = realUrls.length > 0
      ? `ניתוח ${signals.length} אותות | ${sourceSignals.length} מקורות אמיתיים`
      : `ניתוח ${signals.length} אותות מהרשת`;

    await base44.asServiceRole.entities.MarketSignal.create({
      summary: insight.summary,
      impact_level: insight.impact_level || 'medium',
      category: insight.category || 'trend',
      recommended_action: insight.recommended_action || '',
      confidence: insight.confidence || 70,
      source_signals: realUrls.join(' | ') || sourceSignalIds.join(','),
      source_urls: realUrls.join(' | '),
      source_description: sourceDescription,
      source_raw_excerpts: JSON.stringify((insight.source_excerpts || []).slice(0, 3)),
      reasoning_chain: insight.reasoning_chain || '',
      data_freshness: 'עדכני',
      agent_name: AGENT_NAME,
      self_score: insight.self_score || 70,
      is_read: false,
      detected_at: new Date().toISOString(),
      linked_business: profile.id,
    });

    existingSummaries.add(insight.summary);
    created++;

    for (const msg of (insight.messages_to_agents || [])) {
      if (msg.to_agent && msg.subject) {
        outgoingMessages.push({
          from_agent: AGENT_NAME,
          to_agent: msg.to_agent,
          priority: msg.priority || 'normal',
          subject: msg.subject,
          body: msg.body || '',
          timestamp: new Date().toISOString(),
          expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
          acted_on: false,
        });
      }
    }
  }

  // === B: WRITE EPISODIC MEMORY + C: MESSAGES + E: SELF-SCORE ===
  if (sectorKnowledge) {
    const currentEpisodes = readEpisodes(sectorKnowledge);
    const currentMessages = parseMessages(sectorKnowledge.agent_message_queue || '[]');
    const currentScores = readPromptScores(sectorKnowledge);

    const newEpisode: Episode = {
      agent: AGENT_NAME,
      timestamp: new Date().toISOString(),
      run_summary: episode?.run_summary || `ניתחתי ${signals.length} אותות, יצרתי ${created} תובנות`,
      key_findings: episode?.key_findings || [],
      watch_next: episode?.watch_next || [],
      data_quality: episode?.data_quality || 60,
      signals_count: signals.length,
    };

    const updatedMessages = markMessagesActedOn(currentMessages, AGENT_NAME);
    const parsedUpdated: AgentMessage[] = (() => { try { return JSON.parse(updatedMessages); } catch { return []; } })();
    const withOutgoing = buildMessageUpdate(parsedUpdated, outgoingMessages);

    await base44.asServiceRole.entities.SectorKnowledge.update(sectorKnowledge.id, {
      agent_episodic_memory: buildEpisodeUpdate(currentEpisodes, newEpisode),
      agent_message_queue: withOutgoing,
      agent_prompt_scores: buildPromptScoreUpdate(currentScores, AGENT_NAME, episode?.data_quality || 60, episode?.improvement_note),
      last_ml_update: new Date().toISOString(),
      data_points_count: (sectorKnowledge.data_points_count || 0) + signals.length,
    });
  } else if (episode) {
    const newEpisode: Episode = {
      agent: AGENT_NAME,
      timestamp: new Date().toISOString(),
      run_summary: episode.run_summary || '',
      key_findings: episode.key_findings || [],
      watch_next: episode.watch_next || [],
      data_quality: episode.data_quality || 60,
      signals_count: signals.length,
    };
    await base44.asServiceRole.entities.SectorKnowledge.create({
      sector: profile.category,
      region: profile.city,
      linked_business: profile.id,
      agent_episodic_memory: JSON.stringify([newEpisode]),
      agent_message_queue: JSON.stringify(outgoingMessages),
      data_points_count: signals.length,
      last_ml_update: new Date().toISOString(),
    });
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runMarketIntelligence',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: created,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`[runMarketIntelligence] Done: ${created} insights, ${outgoingMessages.length} agent messages, data_quality: ${episode?.data_quality || '?'}`);
  return Response.json({
    signals_processed: signals.length,
    insights_generated: created,
    agent_messages_sent: outgoingMessages.length,
  });
});
