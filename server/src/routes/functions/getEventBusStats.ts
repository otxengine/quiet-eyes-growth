/**
 * getEventBusStats.ts — OTX Dashboard data endpoint
 * Returns SystemEvents, RoutingRules, CompositeSignals stats + AutoActions.
 */
import { Request, Response } from 'express';
import { prisma } from '../../db';

const baseAutoSelect = {
  id: true, created_date: true, linked_business: true,
  agent_name: true, action_type: true, description: true,
  payload: true, result: true, status: true,
  executed_at: true, revenue_impact: true, auto_execute_at: true,
} as const;

export async function getEventBusStats(req: Request, res: Response) {
  const businessProfileId = (req.body?.businessProfileId || req.query?.businessProfileId) as string;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since7d  = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  try {
    const [
      eventCounts,
      recentEvents,
      routingRules,
      compositeSignals,
      pendingActions,
      recentActions,
    ] = await Promise.all([
      // Event counts by status (last 24h)
      prisma.systemEvent.groupBy({
        by: ['routing_status'],
        where: { business_id: businessProfileId, created_at: { gte: new Date(since24h) } },
        _count: { id: true },
      }).catch(() => []),

      // 20 most recent events
      prisma.systemEvent.findMany({
        where: { business_id: businessProfileId },
        orderBy: { created_at: 'desc' },
        take: 20,
      }).catch(() => []),

      // All active routing rules
      prisma.routingRule.findMany({
        where: { is_active: true },
        orderBy: { priority: 'desc' },
      }).catch(() => []),

      // Recent composite signals (7 days)
      prisma.compositeSignal.findMany({
        where: { business_id: businessProfileId, created_at: { gte: new Date(since7d) } },
        orderBy: { created_at: 'desc' },
        take: 15,
      }).catch(() => []),

      // Pending approval actions
      prisma.autoAction.findMany({
        where: { linked_business: businessProfileId, status: 'pending_approval' },
        orderBy: { created_date: 'desc' },
        take: 20,
        select: baseAutoSelect,
      }),

      // Recent completed/rejected actions (7 days)
      prisma.autoAction.findMany({
        where: {
          linked_business: businessProfileId,
          status: { in: ['completed', 'rejected', 'approved', 'executing'] },
          created_date: { gte: new Date(since7d) },
        },
        orderBy: { created_date: 'desc' },
        take: 20,
        select: baseAutoSelect,
      }),
    ]);

    // Agent activation frequency from dispatched events
    const agentFreq: Record<string, number> = {};
    for (const ev of recentEvents) {
      if (ev.dispatched_to) {
        try {
          const agents: string[] = JSON.parse(ev.dispatched_to);
          agents.forEach(a => { agentFreq[a] = (agentFreq[a] || 0) + 1; });
        } catch {}
      }
    }

    return res.json({
      event_counts: Object.fromEntries(eventCounts.map(e => [e.routing_status, e._count.id])),
      recent_events: recentEvents,
      routing_rules: routingRules,
      composite_signals: compositeSignals,
      pending_actions: pendingActions,
      recent_actions: recentActions,
      agent_frequency: agentFreq,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function approveAction(req: Request, res: Response) {
  const { actionId, businessProfileId } = req.body;
  if (!actionId || !businessProfileId) return res.status(400).json({ error: 'Missing params' });

  try {
    const action = await prisma.autoAction.findFirst({
      where: { id: actionId, linked_business: businessProfileId },
      select: baseAutoSelect,
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });

    await prisma.autoAction.update({
      where: { id: actionId },
      data: { status: 'approved', executed_at: new Date().toISOString() },
    });

    // Log outcome
    await prisma.outcomeLog.create({
      data: {
        linked_business:     businessProfileId,
        action_type:         action.action_type,
        was_accepted:        true,
        outcome_description: 'approved_by_user',
        linked_action:       actionId,
        created_at:          new Date().toISOString(),
      },
    }).catch(() => {});

    return res.json({ success: true, status: 'approved' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function rejectAction(req: Request, res: Response) {
  const { actionId, businessProfileId, reason } = req.body;
  if (!actionId || !businessProfileId) return res.status(400).json({ error: 'Missing params' });

  try {
    await prisma.autoAction.update({
      where: { id: actionId },
      data: { status: 'rejected' },
    });

    await prisma.outcomeLog.create({
      data: {
        linked_business:     businessProfileId,
        action_type:         'auto_action',
        was_accepted:        false,
        outcome_description: reason || 'rejected_by_user',
        linked_action:       actionId,
        created_at:          new Date().toISOString(),
      },
    }).catch(() => {});

    return res.json({ success: true, status: 'rejected' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
