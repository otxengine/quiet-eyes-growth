import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

/**
 * intentClassification
 * Classifies a lead's buying intent as hot/warm/cool using Haiku.
 * Called after lead creation to enrich lead.intent_strength and lead.score.
 *
 * Body: { leadId, businessProfileId }
 */
export async function intentClassification(req: Request, res: Response) {
  const { leadId, businessProfileId } = req.body;

  if (!leadId || !businessProfileId) {
    return res.status(400).json({ error: 'Missing leadId or businessProfileId' });
  }

  try {
    const lead = await prisma.lead.findFirst({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const prompt = `Classify the buying intent of this lead in JSON format.

Lead details:
- Name: ${lead.name || 'Unknown'}
- Service needed: ${lead.service_needed || 'Unknown'}
- Source: ${lead.source || 'Unknown'}
- Budget range: ${(lead as any).budget_range || 'Unknown'}
- Notes: ${lead.notes || ''}

Respond with ONLY this JSON:
{
  "intent_level": "hot" | "warm" | "cool",
  "confidence": 0.0-1.0,
  "score": 0-100,
  "signals": ["signal1", "signal2"]
}

Rules:
- hot: actively seeking, has budget, urgent need (score 70-100)
- warm: interested but browsing (score 40-69)
- cool: casual inquiry, no urgency (score 0-39)`;

    const result = await invokeLLM({
      prompt,
      model: 'haiku',
      maxTokens: 200,
      response_json_schema: {
        type: 'object',
        properties: {
          intent_level: { type: 'string' },
          confidence: { type: 'number' },
          score: { type: 'number' },
          signals: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    let classification: any = {};
    try {
      classification = typeof result === 'string' ? JSON.parse(result) : result;
    } catch {
      classification = { intent_level: 'warm', confidence: 0.5, score: 50, signals: [] };
    }

    const { intent_level, confidence, score, signals } = classification;

    // Update lead with intent data
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        score: score ?? lead.score ?? 50,
        intent_strength: intent_level,
        status: intent_level === 'hot' ? 'hot'
              : intent_level === 'warm' ? 'warm'
              : lead.status || 'new',
        notes: lead.notes
          ? `${lead.notes}\n[Intent: ${intent_level} | ${Math.round((confidence || 0.5) * 100)}% confidence | Signals: ${(signals || []).join(', ')}]`
          : `[Intent: ${intent_level} | ${Math.round((confidence || 0.5) * 100)}% confidence]`,
      },
    });

    return res.json({
      success: true,
      leadId,
      intent_level,
      confidence,
      score,
      signals,
    });
  } catch (err: any) {
    console.error('intentClassification error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
