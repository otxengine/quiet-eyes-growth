import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { invokeLLM } from '../../lib/llm';

export async function runPredictions(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [leads, reviews, signals, competitors, existingPredictions] = await Promise.all([
      prisma.lead.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 30 }),
      prisma.review.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 10 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
      prisma.prediction.findMany({ where: { linked_business: businessProfileId, status: 'active' } }),
    ]);

    if (leads.length + reviews.length + signals.length < 3) {
      return res.json({ predictions_created: 0, message: 'Not enough data for predictions yet — run the other agents first' });
    }

    const existingTitles = new Set(existingPredictions.map(p => p.title));

    const avgRating = reviews.length > 0
      ? (reviews.reduce((s, r) => s + (r.rating || 4), 0) / reviews.length).toFixed(1)
      : null;
    const hotLeadsCount = leads.filter(l => l.status === 'hot').length;
    const negativeReviewsCount = reviews.filter(r => r.sentiment === 'negative').length;
    const recentSignals = signals.slice(0, 5).map(s => s.summary).join('; ');

    const result = await invokeLLM({
      prompt: `You are a business analyst specializing in trend forecasting for Israeli businesses.

Business: ${profile.name} (${profile.category}, ${profile.city})
${profile.description ? `Description: ${profile.description}` : ''}
Data:
- ${leads.length} leads, of which ${hotLeadsCount} are hot
- ${reviews.length} reviews, average ${avgRating || 'unknown'}, ${negativeReviewsCount} negative
- ${competitors.length} identified competitors
- Recent market insights: ${recentSignals || 'none yet'}

Generate 2-3 valuable business predictions. For each prediction include:
- title: headline (up to 70 chars)
- summary: description of the prediction (up to 200 chars)
- prediction_type: revenue_trend / lead_flow / reputation_risk / competitive_threat / market_opportunity
- confidence: confidence percentage (50-90)
- timeframe: time range (e.g. "30 ימים", "3 חודשים")
- impact_level: high / medium / low
- recommended_actions: recommended actions (up to 150 chars)

Return ONLY valid JSON. ALL string values must be in Hebrew. {"predictions": [...]}`,
      response_json_schema: { type: 'object' },
    });

    const predictions: any[] = result?.predictions || [];
    let created = 0;

    for (const p of predictions) {
      if (!p.title || existingTitles.has(p.title)) continue;

      await prisma.prediction.create({
        data: {
          title: p.title,
          summary: p.summary || '',
          prediction_type: p.prediction_type || 'market_opportunity',
          confidence: p.confidence || 70,
          timeframe: p.timeframe || '30 ימים',
          impact_level: p.impact_level || 'medium',
          recommended_actions: p.recommended_actions || '',
          is_read: false,
          status: 'active',
          predicted_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      });
      existingTitles.add(p.title);
      created++;
    }

    await writeAutomationLog('runPredictions', businessProfileId, startTime, created);
    console.log(`runPredictions done: ${created} predictions created`);
    return res.json({ predictions_created: created });
  } catch (err: any) {
    console.error('runPredictions error:', err.message);
    await writeAutomationLog('runPredictions', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
