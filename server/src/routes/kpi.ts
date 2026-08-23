/**
 * KPI API
 *
 * GET /api/kpi/:businessId              — funnel KPIs (default 30d)
 * GET /api/kpi/:businessId/velocity     — pipeline velocity
 * GET /api/kpi/tenant/:tenantId         — tenant-level aggregates
 * GET /api/kpi/tenant/:tenantId/about   — about-enrichment funnel (KAN-208)
 * GET /api/kpi/tenant/:tenantId/competitor-discovery — competitor-discovery funnel (KAN-216)
 * GET /api/kpi/tenant/:tenantId/url-enrichment — URL-enrichment funnel (KAN-224)
 */

import { Router, Request, Response } from 'express';
import { computeFunnelKPIs, computePipelineVelocity, computeTenantKPIs, computeAnalysisObservability, computeAboutMetrics, computeCompetitorDiscoveryMetrics, computeUrlEnrichmentMetrics } from '../services/metrics/KPIService';
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

router.get('/:businessId/analysis', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);
  const days       = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const obs = await computeAnalysisObservability(businessId, days);
    return res.json(obs);
  } catch (err: any) {
    logger.error('Analysis observability fetch failed', { businessId, error: err.message });
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

// KAN-208: about-enrichment funnel — approve rate, edit rate, source coverage, empty-block rate
router.get('/tenant/:tenantId/about', async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const days     = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const metrics = await computeAboutMetrics(tenantId, days);
    return res.json(metrics);
  } catch (err: any) {
    logger.error('About metrics fetch failed', { tenantId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// KAN-216: competitor-discovery funnel — precision, coverage, source mix, cost, empty rate
router.get('/tenant/:tenantId/competitor-discovery', async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const days     = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const metrics = await computeCompetitorDiscoveryMetrics(tenantId, days);
    return res.json(metrics);
  } catch (err: any) {
    logger.error('Competitor discovery metrics fetch failed', { tenantId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// KAN-224: URL-enrichment funnel — website fill rate, social source mix, precision, empty-social rate
router.get('/tenant/:tenantId/url-enrichment', async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const days     = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const metrics = await computeUrlEnrichmentMetrics(tenantId, days);
    return res.json(metrics);
  } catch (err: any) {
    logger.error('URL enrichment metrics fetch failed', { tenantId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
