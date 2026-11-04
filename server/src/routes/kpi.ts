/**
 * KPI API
 *
 * GET /api/kpi/:businessId              — funnel KPIs (default 30d)
 * GET /api/kpi/:businessId/velocity     — pipeline velocity
 * GET /api/kpi/tenant/:tenantId         — tenant-level aggregates
 */

import { Router, Request, Response } from 'express';
import { computeFunnelKPIs, computePipelineVelocity, computeTenantKPIs } from '../services/metrics/KPIService';
import { createLogger } from '../infra/logger';

const logger = createLogger('KPIRoute');
const router = Router();

router.get('/:businessId', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);
  const days       = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));

  try {
    const kpis = await computeFunnelKPIs(businessId, days);
    return res.json(kpis);
  } catch (err: any) {
    logger.error('KPI fetch failed', { businessId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:businessId/velocity', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);
  try {
    const velocity = await computePipelineVelocity(businessId);
    return res.json(velocity);
  } catch (err: any) {
    logger.error('Velocity fetch failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

router.get('/tenant/:tenantId', async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const days     = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const kpis = await computeTenantKPIs(tenantId, days);
    return res.json(kpis);
  } catch (err: any) {
    logger.error('Tenant KPI fetch failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
