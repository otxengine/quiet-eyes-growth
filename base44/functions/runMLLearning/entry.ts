import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { callClaude, parseClaudeJson } from '../_shared/claudeApi.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  let profile;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === body.businessProfileId);
  }
  if (!profile) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const bpId = profile.id;

  // --- Load data ---
  const [allLeads, allReviews, competitors, signals] = await Promise.all([
    base44.asServiceRole.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    base44.asServiceRole.entities.Review.filter({ linked_business: bpId }, '-created_date', 100),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
  ]);

  // --- Compute winner DNA ---
  const winners = allLeads.filter((l: any) =>
    l.lifecycle_stage === 'closed_won' || l.status === 'completed'
  );
  const losers = allLeads.filter((l: any) =>
    l.status === 'lost' || l.lifecycle_stage === 'closed_lost'
  );

  const winnerDNA = {
    top_sources: topCount(winners.map((l: any) => l.source).filter(Boolean)),
    top_services: topCount(winners.map((l: any) => l.service_needed).filter(Boolean)),
    top_urgency: topCount(winners.map((l: any) => l.urgency).filter(Boolean)),
    avg_score: avg(winners.map((l: any) => l.score).filter(Boolean)),
    common_intent: topCount(winners.map((l: any) => l.intent_strength).filter(Boolean)),
  };

  const losingPatterns = {
    top_sources: topCount(losers.map((l: any) => l.source).filter(Boolean)),
    top_services: topCount(losers.map((l: any) => l.service_needed).filter(Boolean)),
    avg_score: avg(losers.map((l: any) => l.score).filter(Boolean)),
  };

  // --- Review topics ---
  const positiveReviews = allReviews.filter((r: any) => r.sentiment === 'positive');
  const negativeReviews = allReviews.filter((r: any) => r.sentiment === 'negative');

  // --- Competitor threat score ---
  const trendingUpCount = competitors.filter((c: any) => c.trend_direction === 'up').length;
  const competitorThreatScore = competitors.length > 0
    ? Math.min(100, Math.round((trendingUpCount / competitors.length) * 100 + (competitors.length > 5 ? 20 : 0)))
    : 0;

  // --- Conversion rate ---
  const totalClosed = winners.length + losers.length;
  const conversionRate = totalClosed > 0 ? Math.round((winners.length / totalClosed) * 100) : 0;

  // --- LLM cross-agent insights ---
  let agentInsights: any = null;
  const positiveTexts = positiveReviews.slice(0, 10).map((r: any) => r.text || '').filter(Boolean);
  const negativeTexts = negativeReviews.slice(0, 10).map((r: any) => r.text || '').filter(Boolean);
  const highSignals = signals.filter((s: any) => s.impact_level === 'high').slice(0, 5).map((s: any) => s.summary);

  const prompt = `You are a business intelligence ML system for "${profile.name}", a ${profile.category} in ${profile.city}.

CROSS-AGENT DATA SUMMARY:
- Won deals: ${winners.length} | Lost deals: ${losers.length} | Conversion: ${conversionRate}%
- Winner DNA: ${JSON.stringify(winnerDNA)}
- Losing patterns: ${JSON.stringify(losingPatterns)}
- Positive review themes: ${positiveTexts.slice(0, 5).join(' | ')}
- Negative review themes: ${negativeTexts.slice(0, 5).join(' | ')}
- Competitor threat score: ${competitorThreatScore}/100 (${trendingUpCount} rising competitors of ${competitors.length})
- High-impact signals: ${highSignals.join(' | ') || 'none'}

Generate cross-agent insights — patterns you see across leads, reviews, and competitive data.
Focus on actionable, non-obvious correlations.

Return ONLY valid JSON:
{
  "top_positive_topics": ["topic1", "topic2", "topic3"],
  "top_negative_topics": ["topic1", "topic2"],
  "cross_insights": [
    {"insight": "...", "confidence": 85, "action": "..."},
    {"insight": "...", "confidence": 70, "action": "..."}
  ],
  "ml_summary": "2-sentence summary of what the data tells us in Hebrew"
}`;

  try {
    const claudeText = await callClaude(prompt, {
      systemPrompt: 'You are a business ML analyst. Return ONLY valid JSON.',
      prefill: '{',
      maxTokens: 1024,
    });
    if (claudeText) {
      agentInsights = parseClaudeJson(claudeText, null);
    }
  } catch (_) {}

  if (!agentInsights) {
    try {
      agentInsights = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            top_positive_topics: { type: 'array', items: { type: 'string' } },
            top_negative_topics: { type: 'array', items: { type: 'string' } },
            cross_insights: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  insight: { type: 'string' },
                  confidence: { type: 'number' },
                  action: { type: 'string' },
                },
              },
            },
            ml_summary: { type: 'string' },
          },
        },
      });
    } catch (_) {}
  }

  // --- Rescore warm/cold leads using winner DNA ---
  let rescored = 0;
  const warmColdLeads = allLeads.filter((l: any) =>
    (l.status === 'warm' || l.status === 'cold') && !l.is_archived
  );

  for (const lead of warmColdLeads) {
    let boost = 0;
    if (winnerDNA.top_sources[0] && lead.source === winnerDNA.top_sources[0]) boost += 10;
    if (winnerDNA.top_services[0] && lead.service_needed === winnerDNA.top_services[0]) boost += 8;
    if (winnerDNA.common_intent[0] && lead.intent_strength === winnerDNA.common_intent[0]) boost += 7;
    if (boost > 0) {
      const newScore = Math.min(100, (lead.score || 50) + boost);
      if (newScore !== lead.score) {
        await base44.asServiceRole.entities.Lead.update(lead.id, { score: newScore });
        rescored++;
      }
    }
  }

  // --- Upsert SectorKnowledge ---
  const existing = await base44.asServiceRole.entities.SectorKnowledge.filter({ linked_business: bpId });
  const sectorPayload: any = {
    winner_lead_dna: JSON.stringify(winnerDNA),
    losing_lead_patterns: JSON.stringify(losingPatterns),
    competitor_threat_score: competitorThreatScore,
    wins_count: winners.length,
    losses_count: losers.length,
    conversion_rate: conversionRate,
    ml_last_run: new Date().toISOString(),
    linked_business: bpId,
  };

  if (agentInsights) {
    if (agentInsights.top_positive_topics) {
      sectorPayload.top_review_topics_positive = JSON.stringify(agentInsights.top_positive_topics);
    }
    if (agentInsights.top_negative_topics) {
      sectorPayload.top_review_topics_negative = JSON.stringify(agentInsights.top_negative_topics);
    }
    sectorPayload.agent_insights = JSON.stringify(agentInsights.cross_insights || []);
  }

  if (existing.length > 0) {
    await base44.asServiceRole.entities.SectorKnowledge.update(existing[0].id, sectorPayload);
  } else {
    await base44.asServiceRole.entities.SectorKnowledge.create({
      sector: profile.category,
      region: profile.city,
      ...sectorPayload,
    });
  }

  // --- AutomationLog ---
  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runMLLearning',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: rescored,
      linked_business: bpId,
    });
  } catch (_) {}

  console.log(`runMLLearning: wins=${winners.length}, losses=${losers.length}, conversion=${conversionRate}%, rescored=${rescored}`);
  return Response.json({
    wins: winners.length,
    losses: losers.length,
    conversion_rate: conversionRate,
    competitor_threat_score: competitorThreatScore,
    rescored_leads: rescored,
    ml_summary: agentInsights?.ml_summary || null,
  });
});

// --- Helpers ---
function topCount(arr: string[]): string[] {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
