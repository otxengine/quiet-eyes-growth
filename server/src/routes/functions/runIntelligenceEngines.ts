import { Request, Response } from 'express';
import { buildEnrichedContext } from '../../intelligence/ContextBuilder';
import { runIntelligenceEngines as runEngines } from '../../services/intelligence/MarketIntelligenceService';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

export async function runIntelligenceEngines(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  const traceId = `rie_${Date.now()}`;
  try {
    const ctx = await buildEnrichedContext(businessProfileId);
    const result = await runEngines(ctx, traceId);

    if (result.insights.length > 0) {
      await Promise.allSettled(
        result.insights.map(insight =>
          prisma.$executeRawUnsafe(
            `INSERT INTO market_insights (id, business_id, insight_type, title, description, urgency, confidence, data_payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
             ON CONFLICT (id) DO NOTHING`,
            insight.id,
            businessProfileId,
            insight.type,
            insight.title,
            insight.summary,
            insight.urgency,
            insight.confidence,
            JSON.stringify(insight),
          )
        )
      );
    }

    await writeAutomationLog('runIntelligenceEngines', businessProfileId, startTime, result.insights.length);
    return res.json({
      ok: true,
      insights: result.insights.length,
      engines_run: result.engines_run,
      duration_ms: result.duration_ms,
    });
  } catch (err: any) {
    await writeAutomationLog('runIntelligenceEngines', businessProfileId, startTime, 0, 'failed', err.message);
    return res.json({ ok: false, error: err.message });
  }
}
