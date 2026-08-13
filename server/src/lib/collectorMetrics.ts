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
  skipped_ran_recently: number;
  skipped_no_data: number;
  error_rate: number;
  skip_rate: number;
}

export interface TrendMetrics {
  window_hours: number;
  avg_trends_created: number;
  avg_signals_created: number;
  early_trend_rate: number;
  viral_hit_rate: number;
  growth_businesses_total: number;
  viral_hit_businesses: number;
  // AC5: raw UX event counts for the last 24h
  ux_cta_from_viral_24h: number;
  ux_early_trend_restore_24h: number;
  ux_upgrade_from_hint_24h: number;
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
        COUNT(*)::int                                                                       AS total,
        COUNT(*) FILTER (WHERE status = 'failed')::int                                     AS failed,
        COUNT(*) FILTER (WHERE error_message = 'ran_recently')::int                        AS skipped_ran_recently,
        COUNT(*) FILTER (WHERE error_message = 'no_data_sources')::int                     AS skipped_no_data,
        COUNT(*) FILTER (WHERE error_message IN ('ran_recently', 'no_data_sources'))::int  AS skipped
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
    automation_name:      r.automation_name,
    total:                Number(r.total),
    failed:               Number(r.failed),
    skipped:              Number(r.skipped),
    skipped_ran_recently: Number(r.skipped_ran_recently),
    skipped_no_data:      Number(r.skipped_no_data),
    error_rate: Number(r.total) > 0 ? Number(r.failed)  / Number(r.total) : 0,
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

// AC1 + AC2 (KAN-88): trend yield, early-trend rate, viral hit rate
export async function getTrendMetrics(windowHours = 720): Promise<TrendMetrics> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const rate = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 1000 : 0;

  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [yieldRows, earlyRows, totalTrendRows, viralBizRows, growthBizRows, uxEventRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(`
      SELECT automation_name, ROUND(AVG(items_processed)::numeric, 2)::text AS avg_items
      FROM automation_logs
      WHERE automation_name IN ('detectTrends', 'detectEarlyTrends', 'detectViralSignals')
        AND created_date >= $1::timestamptz
        AND status = 'success'
        AND (error_message IS NULL OR error_message NOT IN ('ran_recently', 'no_data_sources'))
      GROUP BY automation_name
    `, since),
    prisma.$queryRawUnsafe<[{ n: string }]>(`
      SELECT COUNT(*)::text AS n FROM market_signals
      WHERE category = 'trend' AND impact_level = 'high' AND detected_at >= $1
    `, since),
    prisma.$queryRawUnsafe<[{ n: string }]>(`
      SELECT COUNT(*)::text AS n FROM market_signals
      WHERE category = 'trend' AND detected_at >= $1
    `, since),
    prisma.$queryRawUnsafe<[{ n: string }]>(`
      SELECT COUNT(DISTINCT ms.linked_business)::text AS n
      FROM market_signals ms
      JOIN business_profiles bp ON bp.id = ms.linked_business
      WHERE ms.category = 'viral_signal'
        AND ms.detected_at >= $1
        AND bp.subscription_plan IN ('growth', 'pro', 'enterprise')
    `, since),
    prisma.$queryRawUnsafe<[{ n: string }]>(`
      SELECT COUNT(*)::text AS n FROM business_profiles
      WHERE subscription_plan IN ('growth', 'pro', 'enterprise')
    `),
    prisma.$queryRawUnsafe<Array<{ event_type: string; n: string }>>(`
      SELECT event_type, COUNT(*)::text AS n
      FROM system_events
      WHERE event_type IN ('ux_cta_from_viral', 'ux_early_trend_restore', 'ux_upgrade_from_hint')
        AND created_at >= $1::timestamptz
      GROUP BY event_type
    `, since24h),
  ]);

  const byAgent: Record<string, number> = {};
  for (const r of yieldRows as any[]) byAgent[r.automation_name] = parseFloat(r.avg_items) || 0;

  const earlyCount  = Number((earlyRows      as any[])[0]?.n ?? 0);
  const totalTrends = Number((totalTrendRows as any[])[0]?.n ?? 0);
  const viralBiz    = Number((viralBizRows   as any[])[0]?.n ?? 0);
  const growthBiz   = Number((growthBizRows  as any[])[0]?.n ?? 0);

  const uxByType: Record<string, number> = {};
  for (const r of uxEventRows as any[]) uxByType[r.event_type] = Number(r.n);

  return {
    window_hours:               windowHours,
    avg_trends_created:         byAgent['detectTrends']      ?? 0,
    avg_signals_created:        byAgent['detectViralSignals'] ?? 0,
    early_trend_rate:           rate(earlyCount, totalTrends),
    viral_hit_rate:             rate(viralBiz, growthBiz),
    growth_businesses_total:    growthBiz,
    viral_hit_businesses:       viralBiz,
    ux_cta_from_viral_24h:      uxByType['ux_cta_from_viral']         ?? 0,
    ux_early_trend_restore_24h: uxByType['ux_early_trend_restore']    ?? 0,
    ux_upgrade_from_hint_24h:   uxByType['ux_upgrade_from_hint']      ?? 0,
  };
}
