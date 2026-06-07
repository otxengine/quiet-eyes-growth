import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * systemHealthMonitor
 * Internal agent: checks agent run health via AutomationLog.
 * Groups by automation_name, flags agents that haven't run in >24h or have errors.
 *
 * Body: { businessProfileId? }  — if omitted, checks platform-wide
 */
export async function systemHealthMonitor(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  const startTime = new Date().toISOString();

  try {
    const cutoff48h = new Date(Date.now() - 48 * 3600000);

    // Fetch recent automation logs
    const where: any = { start_time: { gte: cutoff48h } };
    if (businessProfileId) where.linked_business = businessProfileId;

    const logs = await prisma.automationLog.findMany({
      where,
      orderBy: { start_time: 'desc' },
      take: 1000,
    });

    // Group by agent name — keep latest entry per agent
    const agentMap: Record<string, any> = {};
    for (const log of logs) {
      const name = log.automation_name || 'unknown';
      if (!agentMap[name]) agentMap[name] = log;
    }

    const now = Date.now();
    const agentStatus = Object.values(agentMap).map((log: any) => {
      const lastRunMs = log.start_time ? new Date(log.start_time).getTime() : 0;
      const hoursAgo = Math.floor((now - lastRunMs) / 3600000);
      const status = log.status === 'error' ? 'error'
        : hoursAgo > 24 ? 'stale'
        : hoursAgo > 12 ? 'warning'
        : 'ok';

      return {
        name: log.automation_name,
        lastRun: log.start_time,
        hoursAgo,
        status,
        itemsProcessed: log.items_processed ?? 0,
        errorMessage: log.error_message || null,
        linkedBusiness: log.linked_business || null,
      };
    });

    // DB stats (lightweight counts)
    const [leadCount, signalCount, alertCount, reviewCount] = await Promise.all([
      prisma.lead.count({ where: businessProfileId ? { linked_business: businessProfileId } : {} }),
      prisma.marketSignal.count({ where: businessProfileId ? { linked_business: businessProfileId } : {} }),
      prisma.proactiveAlert.count({ where: businessProfileId ? { linked_business: businessProfileId } : {} }),
      prisma.review.count({ where: businessProfileId ? { linked_business: businessProfileId } : {} }),
    ]);

    const errorAgents = agentStatus.filter(a => a.status === 'error');
    const staleAgents = agentStatus.filter(a => a.status === 'stale');

    // Write summary to AutomationLog
    await writeAutomationLog(
      'systemHealthMonitor',
      businessProfileId || 'platform',
      startTime,
      agentStatus.length,
      errorAgents.length > 0 ? 'failed' : 'success',
      errorAgents.length > 0
        ? `${errorAgents.length} agents in error state: ${errorAgents.map(a => a.name).join(', ')}`
        : undefined,
    );

    return res.json({
      success: true,
      summary: {
        totalAgents: agentStatus.length,
        ok: agentStatus.filter(a => a.status === 'ok').length,
        warning: agentStatus.filter(a => a.status === 'warning').length,
        stale: staleAgents.length,
        errors: errorAgents.length,
      },
      agentStatus: agentStatus.sort((a, b) => {
        const order = { error: 0, stale: 1, warning: 2, ok: 3 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      }),
      dbStats: { leadCount, signalCount, alertCount, reviewCount },
    });
  } catch (err: any) {
    console.error('systemHealthMonitor error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
