/**
 * Explainability API
 *
 * GET /api/explain/decision/:decisionId?businessId=   — decision explanation
 * GET /api/explain/insight/:insightId?businessId=     — insight explanation
 * GET /api/explain/recommendation/:recId?businessId=  — recommendation explanation
 */

import { Router, Request, Response } from 'express';
import {
  getDecisionExplanation,
  getInsightExplanation,
  getRecommendationExplanation,
} from '../services/explainability/ExplainabilityService';
import { createLogger } from '../infra/logger';

const logger = createLogger('ExplainabilityRoute');
const router = Router();

// ─── GET /api/explain/decision/:decisionId ────────────────────────────────────

router.get('/decision/:decisionId', async (req: Request, res: Response) => {
  const decisionId = String(req.params.decisionId);
  const businessId = String(req.query.businessId ?? '');

  if (!businessId) {
    return res.status(400).json({ error: 'businessId query param required' });
  }

  try {
    const explanation = await getDecisionExplanation(decisionId, businessId);
    if (!explanation) {
      return res.status(404).json({ error: 'No explanation found for this decision' });
    }
    return res.json(explanation);
  } catch (err: any) {
    logger.error('Decision explanation fetch failed', { decisionId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/explain/insight/:insightId ─────────────────────────────────────

router.get('/insight/:insightId', async (req: Request, res: Response) => {
  const insightId  = String(req.params.insightId);
  const businessId = String(req.query.businessId ?? '');

  if (!businessId) {
    return res.status(400).json({ error: 'businessId query param required' });
  }

  try {
    const explanation = await getInsightExplanation(insightId, businessId);
    if (!explanation) {
      return res.status(404).json({ error: 'No explanation found for this insight' });
    }
    return res.json(explanation);
  } catch (err: any) {
    logger.error('Insight explanation fetch failed', { insightId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/explain/recommendation/:recId ──────────────────────────────────

router.get('/recommendation/:recId', async (req: Request, res: Response) => {
  const recId      = String(req.params.recId);
  const businessId = String(req.query.businessId ?? '');

  if (!businessId) {
    return res.status(400).json({ error: 'businessId query param required' });
  }

  try {
    const explanation = await getRecommendationExplanation(recId, businessId);
    if (!explanation) {
      return res.status(404).json({ error: 'No explanation found for this recommendation' });
    }
    return res.json(explanation);
  } catch (err: any) {
    logger.error('Recommendation explanation fetch failed', { recId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
