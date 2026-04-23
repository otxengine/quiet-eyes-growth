import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
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
  if (!profile) return Response.json({ error: 'No business profile', predictions_created: 0 }, { status: 404 });

  const { name, category, city, id: bpId } = profile;

  // Gather data for predictions
  const [signals, leads, competitors, reviews, sector] = await Promise.all([
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    base44.asServiceRole.entities.Lead.filter({ linked_business: bpId }, '-created_date', 50),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Review.filter({ linked_business: bpId }, '-created_date', 30),
    base44.asServiceRole.entities.SectorKnowledge.filter({}),
  ]);

  const hotLeads = leads.filter(l => l.status === 'hot');
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const recentSignals = signals.filter(s => (s.detected_at || s.created_date) >= weekAgo);
  const threats = signals.filter(s => s.category === 'threat');
  const opportunities = signals.filter(s => s.category === 'opportunity');
  const negReviews = reviews.filter(r => r.sentiment === 'negative');
  const posReviews = reviews.filter(r => r.sentiment === 'positive');
  const sectorData = sector[0];

  const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are a business prediction specialist for Israeli SMBs.

BUSINESS: ${name}, Category: ${category}, City: ${city}

DATA FOR ANALYSIS:
- ${signals.length} market signals (${recentSignals.length} this week, ${threats.length} threats, ${opportunities.length} opportunities)
- ${leads.length} leads total (${hotLeads.length} hot)
- ${competitors.length} competitors tracked: ${competitors.slice(0, 5).map(c => `${c.name} (${c.rating}, ${c.trend_direction})`).join(', ')}
- ${reviews.length} reviews (${posReviews.length} positive, ${negReviews.length} negative)
- Sector avg rating: ${sectorData?.avg_rating || '?'}, trending: ${sectorData?.trending_services || '?'}
- Recent signals: ${recentSignals.slice(0, 8).map(s => s.summary).join('; ')}
- Recent negative reviews: ${negReviews.slice(0, 3).map(r => (r.text || '').slice(0, 80)).join('; ')}

Generate 3-5 predictions:

1. DEMAND FORECAST: Predict demand changes for next month
2. CHURN RISK: Identify customers/segments likely to churn
3. DEAL PROBABILITY: Estimate conversion for current hot leads
4. MARKET TREND: Predict emerging trends
5. SCENARIO: "What if" analysis (price change, new competitor, etc.)

For each prediction:
- prediction_type: demand_forecast / churn_risk / deal_probability / market_trend / scenario
- title: short Hebrew title (max 40 chars)
- summary: detailed Hebrew explanation (2-3 sentences)
- confidence: 40-95
- timeframe: e.g. "חודש הבא", "רבעון הקרוב"
- impact_level: high / medium / low
- recommended_actions: 2-3 bullet points in Hebrew (separated by newlines)
- data_sources: what data this prediction is based on

ALL TEXT IN HEBREW.`,
    model: 'gemini_3_flash',
    add_context_from_internet: true,
    response_json_schema: {
      type: "object",
      properties: {
        predictions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              prediction_type: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
              confidence: { type: "number" },
              timeframe: { type: "string" },
              impact_level: { type: "string" },
              recommended_actions: { type: "string" },
              data_sources: { type: "string" }
            }
          }
        }
      }
    }
  });

  const predictions = llmResult?.predictions || [];
  let created = 0;
  const now = new Date().toISOString();

  for (const pred of predictions) {
    if (!pred.title) continue;
    await base44.asServiceRole.entities.Prediction.create({
      linked_business: bpId,
      prediction_type: pred.prediction_type || 'market_trend',
      title: pred.title,
      summary: pred.summary || '',
      confidence: pred.confidence || 60,
      timeframe: pred.timeframe || '',
      impact_level: pred.impact_level || 'medium',
      recommended_actions: pred.recommended_actions || '',
      data_sources: pred.data_sources || '',
      is_read: false,
      status: 'active',
      predicted_at: now,
    });
    created++;
  }

  console.log(`runPredictions complete: ${created} predictions created`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runPredictions',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: created,
      linked_business: bpId,
    });
  } catch (_) {}

  return Response.json({ predictions_created: created });
  } catch (error) {
    console.error('runPredictions error:', error.message);
    return Response.json({ error: error.message, predictions_created: 0 }, { status: 500 });
  }
});