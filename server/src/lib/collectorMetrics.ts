import { prisma } from '../db';
import { sendEmail } from './email';

export interface CollectorMetrics {
  window_hours: number;
  agents: AgentMetric[];
  cost_by_business: BusinessCost[];
}

export interface AgentMetric {
  automation_name: string;
  total: number;
  failed: number;
  skipped: number;
  error_rate: number;
  skip_rate: number;
}

export interface BusinessCost {
  linked_business: string;
  total_cost_usd: number;
  run_count: number;
}

export async function getCollectorMetrics(windowHours = 24): Promise<CollectorMetrics> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  const [agentRows, costRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(`
      SELECT
        automation_name,
        COUNT(*)::int                                                AS total,
        COUNT(*) FILTER (WHERE status = 'failed')::int              AS failed,
        COUNT(*) FILTER (WHERE error_message = 'ran_recently')::int AS skipped
      FROM automation_logs
      WHERE created_date >= $1::timestamptz
      GROUP BY automation_name
      ORDER BY automation_name
    `, since),
    prisma.$queryRawUnsafe<any[]>(`
      SELECT
        linked_business,
        COALESCE(SUM(cost_usd), 0)::float AS total_cost_usd,
        COUNT(*)::int                      AS run_count
      FROM automation_logs
      WHERE created_date >= $1::timestamptz
        AND linked_business IS NOT NULL
      GROUP BY linked_business
      ORDER BY total_cost_usd DESC
    `, since),
  ]);

  const agents: AgentMetric[] = agentRows.map(r => ({
    automation_name: r.automation_name,
    total:      Number(r.total),
    failed:     Number(r.failed),
    skipped:    Number(r.skipped),
    error_rate: Number(r.total) > 0 ? Number(r.failed) / Number(r.total) : 0,
    skip_rate:  Number(r.total) > 0 ? Number(r.skipped) / Number(r.total) : 0,
  }));

  const cost_by_business: BusinessCost[] = costRows.map(r => ({
    linked_business: r.linked_business,
    total_cost_usd:  Number(r.total_cost_usd),
    run_count:       Number(r.run_count),
  }));

  return { window_hours: windowHours, agents, cost_by_business };
}

export async function checkAndAlertFailureRate(): Promise<void> {
  const OPS_EMAIL = process.env.OPS_ALERT_EMAIL || '';
  const THRESHOLD = parseFloat(process.env.COLLECTOR_ERROR_RATE_THRESHOLD || '0.20');

  if (!OPS_EMAIL) {
    console.log('[collectorMetrics] OPS_ALERT_EMAIL not set — skipping alert check');
    return;
  }

  const metrics = await getCollectorMetrics(24);
  const breached = metrics.agents.filter(a => a.total >= 5 && a.error_rate >= THRESHOLD);

  if (breached.length === 0) return;

  const rows = breached
    .map(a => `<tr><td>${a.automation_name}</td><td>${(a.error_rate * 100).toFixed(1)}%</td><td>${a.failed}/${a.total}</td></tr>`)
    .join('');

  await sendEmail({
    to: OPS_EMAIL,
    subject: `[OTX Alert] Collector failure rate exceeded threshold (${breached.length} agent${breached.length > 1 ? 's' : ''})`,
    html: `
<html><body style="font-family:Arial,sans-serif;padding:20px">
<h2 style="color:#dc2626">Collector Failure Rate Alert</h2>
<p>The following collectors exceeded the ${(THRESHOLD * 100).toFixed(0)}% failure-rate threshold in the last 24 hours:</p>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">
  <tr style="background:#f3f4f6"><th>Agent</th><th>Error Rate</th><th>Failed/Total</th></tr>
  ${rows}
</table>
<p style="color:#6b7280;font-size:12px">Sent by OTX Engine — check server/src/lib/collectorMetrics.ts to adjust threshold.</p>
</body></html>`,
  });

  console.log(`[collectorMetrics] Alert sent to ${OPS_EMAIL} for ${breached.length} breached agent(s)`);
}
