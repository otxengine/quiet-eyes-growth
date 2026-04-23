/**
 * Orchestrator API
 *
 * POST   /api/orchestrator/run            — full pipeline run
 * POST   /api/orchestrator/run/decision   — decision-only run
 * GET    /api/orchestrator/status/:bpId   — recent pipeline activity
 * POST   /api/orchestrator/outcome        — record an action outcome
 * GET    /api/orchestrator/running        — list currently-running businesses
 */

import { Router, Request, Response } from 'express';
import {
  runPipeline,
  runDecisionOnly,
  getRunningBusinesses,
  OrchestratorOptions,
} from '../orchestration/MasterOrchestrator';
import { recordOutcome, getOutcomeSummary } from '../services/learning/OutcomeTracker';
import { prisma } from '../db';
import { createLogger } from '../infra/logger';
import { nanoid } from 'nanoid';

const logger = createLogger('OrchestratorRoute');
const router = Router();

// ─── POST /api/orchestrator/run ───────────────────────────────────────────────

router.post('/run', async (req: Request, res: Response) => {
  const { businessProfileId, mode, triggeredBy, skipStages, forceRun } = req.body;

  if (!businessProfileId) {
    return res.status(400).json({ error: 'businessProfileId required' });
  }

  const options: OrchestratorOptions = {
    mode:        mode        ?? 'full',
    triggeredBy: triggeredBy ?? 'manual',
    skipStages:  skipStages  ?? [],
    forceRun:    forceRun    ?? false,
  };

  logger.info('Pipeline run triggered via API', { businessProfileId, options });

  try {
    const run = await runPipeline(businessProfileId, options);
    return res.json(run);
  } catch (err: any) {
    logger.error('Pipeline run failed', { businessProfileId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/orchestrator/run/decision ──────────────────────────────────────

router.post('/run/decision', async (req: Request, res: Response) => {
  const { businessProfileId } = req.body;

  if (!businessProfileId) {
    return res.status(400).json({ error: 'businessProfileId required' });
  }

  try {
    const run = await runDecisionOnly(businessProfileId);
    return res.json(run);
  } catch (err: any) {
    logger.error('Decision run failed', { businessProfileId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/orchestrator/status/:bpId ───────────────────────────────────────

router.get('/status/:bpId', async (req: Request, res: Response) => {
  const bpId = String(req.params.bpId);

  try {
    const [recentRuns, recentDecisions, recentAlerts, outcomeSummary] = await Promise.all([
      // Recent pipeline runs from otx_pipeline_runs
      prisma.$queryRawUnsafe<Array<{
        run_id: string; mode: string; status: string;
        started_at: string; decisions_created: number; duration_ms: number;
      }>>(
        `SELECT run_id, mode, status, started_at, decisions_created, duration_ms
         FROM otx_pipeline_runs
         WHERE business_id = $1
         ORDER BY started_at DESC
         LIMIT 10`,
        bpId,
      ).catch(() => []),

      // Recent decisions from otx_decisions
      prisma.$queryRawUnsafe<Array<{
        id: string; action_type: string; final_score: number;
        urgency: string; execution_mode: string; created_at: string;
      }>>(
        `SELECT id, action_type, final_score, urgency, execution_mode, created_at
         FROM otx_decisions
         WHERE business_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        bpId,
      ).catch(() => []),

      // Proactive alerts (dashboard notifications)
      prisma.proactiveAlert.findMany({
        where: { linked_business: bpId, is_dismissed: false },
        orderBy: { created_at: 'desc' },
        take: 5,
      }).catch(() => []),

      // Outcome summary
      getOutcomeSummary(bpId),
    ]);

    return res.json({
      business_id:    bpId,
      is_running:     getRunningBusinesses().includes(bpId),
      recent_runs:    recentRuns,
      recent_decisions: recentDecisions,
      active_alerts:  recentAlerts,
      outcome_summary: outcomeSummary,
    });
  } catch (err: any) {
    logger.error('Status fetch failed', { bpId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/orchestrator/outcome ───────────────────────────────────────────

router.post('/outcome', async (req: Request, res: Response) => {
  const {
    decisionId,
    businessProfileId,
    agentName,
    result,           // 'success' | 'failure' | 'partial'
    revenueImpact,
    notes,
  } = req.body;

  if (!decisionId || !businessProfileId || !result) {
    return res.status(400).json({ error: 'decisionId, businessProfileId, result required' });
  }

  if (!['success', 'failure', 'partial'].includes(result)) {
    return res.status(400).json({ error: 'result must be success | failure | partial' });
  }

  try {
    const outcome = await recordOutcome({
      decisionId,
      businessId:    businessProfileId,
      agentName:     agentName ?? 'unknown',
      result,
      revenueImpact: revenueImpact ?? null,
      notes:         notes ?? '',
      traceId:       `api_${nanoid(10)}`,
    });

    return res.json({ ok: true, outcome_id: outcome.id });
  } catch (err: any) {
    logger.error('Outcome record failed', { decisionId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/orchestrator/running ────────────────────────────────────────────

router.get('/running', (_req: Request, res: Response) => {
  return res.json({ running: getRunningBusinesses() });
});

// ─── GET /api/orchestrator/trace/:recommendationId ────────────────────────────
// Full backward traceability: recommendation → decision → insight → signals → opportunities

router.get('/trace/:recommendationId', async (req: Request, res: Response) => {
  const recId = String(req.params.recommendationId);

  try {
    // 1. Load recommendation
    const [rec] = await prisma.$queryRawUnsafe<Array<{
      id: string; decision_id: string; business_id: string;
      title: string; channel: string; urgency: string;
      insight_id: string | null; opportunity_ids: string | null;
      signal_ids: string | null; trace_id: string | null;
      created_at: string;
    }>>(
      `SELECT id, decision_id, business_id, title, channel, urgency,
              insight_id, opportunity_ids, signal_ids, trace_id, created_at
       FROM otx_recommendations WHERE id = $1`,
      recId,
    ).catch(() => []);

    if (!rec) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    // 2. Load decision
    const [decision] = await prisma.$queryRawUnsafe<Array<{
      id: string; action_type: string; final_score: number;
      execution_mode: string; status: string; insight_id: string | null;
      fused_insight_id: string | null; created_at: string;
    }>>(
      `SELECT id, action_type, final_score, execution_mode, status,
              insight_id, fused_insight_id, created_at
       FROM otx_decisions WHERE id = $1`,
      rec.decision_id,
    ).catch(() => []);

    // 3. Load insight
    const insightId = rec.insight_id ?? decision?.insight_id ?? decision?.fused_insight_id;
    const [insight] = insightId
      ? await prisma.$queryRawUnsafe<Array<{
          id: string; urgency: string; confidence: number;
          summary: string; top_opportunity: string | null; created_at: string;
        }>>(
          `SELECT id, urgency, confidence, summary, created_at
           FROM otx_fused_insights WHERE id = $1`,
          insightId,
        ).catch(() => [])
      : [undefined];

    // 4. Load active opportunities linked to this recommendation
    const oppIds: string[] = (() => {
      try { return rec.opportunity_ids ? JSON.parse(rec.opportunity_ids) : []; } catch { return []; }
    })();

    const opportunities = oppIds.length > 0
      ? await prisma.$queryRawUnsafe<Array<{
          id: string; type: string; urgency: string; opportunity_score: number;
          explanation: string; status: string;
        }>>(
          `SELECT id, type, urgency, opportunity_score, explanation, status
           FROM otx_opportunities
           WHERE id = ANY($1::text[])`,
          oppIds,
        ).catch(() => [])
      : [];

    // 5. Load signals
    const sigIds: string[] = (() => {
      try { return rec.signal_ids ? JSON.parse(rec.signal_ids) : []; } catch { return []; }
    })();

    // 6. Load execution tasks linked to this decision
    const tasks = await prisma.$queryRawUnsafe<Array<{
      id: string; status: string; channel: string;
      task_type: string; created_at: string;
    }>>(
      `SELECT id, status, channel, task_type, created_at
       FROM otx_execution_tasks WHERE decision_id = $1
       ORDER BY created_at DESC LIMIT 5`,
      rec.decision_id,
    ).catch(() => []);

    // 7. Load feedback events linked to this decision
    const feedback = await prisma.$queryRawUnsafe<Array<{
      id: string; rating: string | null; score: number | null;
      agent_name: string | null; created_date: string;
    }>>(
      `SELECT id, rating, score, agent_name, created_date
       FROM feedback_events
       WHERE ai_output_id = $1
       ORDER BY created_date DESC LIMIT 5`,
      rec.decision_id,
    ).catch(() => []);

    return res.json({
      recommendation: rec,
      decision:       decision ?? null,
      insight:        insight ?? null,
      opportunities,
      signal_ids:     sigIds,
      execution_tasks: tasks,
      feedback,
      trace_id:       rec.trace_id,
    });
  } catch (err: any) {
    logger.error('Trace fetch failed', { recId, error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
