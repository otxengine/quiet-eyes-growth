/**
 * ROI API
 *
 * GET  /api/roi/:bpId                    — aggregate ROI metrics for dashboard
 * GET  /api/auto-actions/:bpId           — list AutoActions (recent + pending)
 * PUT  /api/auto-actions/:id/approve     — approve + immediately execute a pending action
 * PUT  /api/auto-actions/:id/reject      — reject a pending action
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { dispatch } from '../services/execution/executeOrQueue';
import { createLogger } from '../infra/logger';

const logger = createLogger('ROIRoute');
const router = Router();

// ─── GET /api/roi/:bpId ───────────────────────────────────────────────────────

router.get('/roi/:bpId', async (req: Request, res: Response) => {
  const bpId = String(req.params.bpId);
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

    const [actions, leads] = await Promise.all([
      prisma.autoAction.findMany({
        where: { linked_business: bpId, created_date: { gte: new Date(thirtyDaysAgo) } },
        orderBy: { created_date: 'desc' },
        take: 200,
      }),
      prisma.lead.findMany({
        where: {
          linked_business: bpId,
          platform_sourced: true,
          status: { in: ['closed_won', 'completed'] },
        },
        select: { deal_value: true, created_date: true },
      }),
    ]);

    const completed = actions.filter(a => a.status === 'completed');
    const pending   = actions.filter(a => a.status === 'pending_approval');
    const failed    = actions.filter(a => a.status === 'failed');

    const totalRevenueImpact = completed.reduce((sum, a) => sum + (a.revenue_impact || 0), 0);
    const pendingRevenueImpact = pending.reduce((sum, a) => sum + (a.revenue_impact || 0), 0);
    const platformRevenue = leads.reduce((sum, l) => sum + (l.deal_value || 0), 0);

    const byType = completed.reduce<Record<string, number>>((acc, a) => {
      acc[a.action_type] = (acc[a.action_type] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      period_days: 30,
      total_actions: actions.length,
      completed: completed.length,
      pending: pending.length,
      failed: failed.length,
      total_revenue_impact: totalRevenueImpact,
      pending_revenue_impact: pendingRevenueImpact,
      platform_revenue: platformRevenue,
      by_type: byType,
      recent_actions: actions.slice(0, 10).map(a => ({
        id: a.id,
        agent_name: a.agent_name,
        action_type: a.action_type,
        description: a.description,
        status: a.status,
        revenue_impact: a.revenue_impact,
        executed_at: a.executed_at,
        auto_execute_at: a.auto_execute_at,
        created_date: a.created_date,
      })),
    });
  } catch (err: any) {
    logger.error('ROI fetch failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auto-actions/:bpId ─────────────────────────────────────────────

router.get('/auto-actions/:bpId', async (req: Request, res: Response) => {
  const bpId = String(req.params.bpId);
  const status = req.query.status as string | undefined;
  const take = Math.min(Number(req.query.take) || 50, 100);

  try {
    const where: any = { linked_business: bpId };
    if (status) where.status = status;

    const actions = await prisma.autoAction.findMany({
      where,
      orderBy: { created_date: 'desc' },
      take,
    });

    return res.json({ actions, count: actions.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/auto-actions/:id/approve ───────────────────────────────────────

router.put('/auto-actions/:id/approve', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const action = await prisma.autoAction.findUnique({ where: { id } });
    if (!action) return res.status(404).json({ error: 'AutoAction not found' });
    if (action.status !== 'pending_approval') {
      return res.status(409).json({ error: `Cannot approve action with status: ${action.status}` });
    }

    await prisma.autoAction.update({ where: { id }, data: { status: 'executing' } });

    try {
      let payload: Record<string, any> = {};
      try { payload = JSON.parse(action.payload || '{}'); } catch {}

      const result = await dispatch({
        businessProfileId: action.linked_business,
        agentName: action.agent_name,
        actionType: action.action_type as any,
        description: action.description,
        payload,
      });

      await prisma.autoAction.update({
        where: { id },
        data: { status: 'completed', executed_at: new Date().toISOString(), result },
      });

      logger.info('AutoAction approved + executed', { id, type: action.action_type });
      return res.json({ id, status: 'completed', result });
    } catch (execErr: any) {
      await prisma.autoAction.update({
        where: { id },
        data: { status: 'failed', result: execErr.message },
      });
      return res.status(500).json({ error: execErr.message });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/auto-actions/:id/reject ────────────────────────────────────────

router.put('/auto-actions/:id/reject', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const action = await prisma.autoAction.findUnique({ where: { id } });
    if (!action) return res.status(404).json({ error: 'AutoAction not found' });

    await prisma.autoAction.update({
      where: { id },
      data: { status: 'rejected', result: req.body.reason || 'נדחה על ידי המשתמש' },
    });

    return res.json({ id, status: 'rejected' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
