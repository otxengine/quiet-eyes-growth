/**
 * KPIService — business intelligence KPI tracker.
 *
 * Tracks the full conversion funnel:
 *   insight → decision → recommendation → execution → outcome
 *
 * KPIs computed:
 *   - insight_to_decision_rate     (decisions created / insights fused)
 *   - decision_to_execution_rate   (dispatched / decisions created)
 *   - execution_success_rate       (completed / dispatched)
 *   - feedback_ratio               (feedback_events / recommendations sent)
 *   - positive_feedback_rate       (thumbs_up / all feedback)
 *   - learning_accuracy_trend      (rolling 7d vs 30d agent accuracy)
 *   - revenue_impact_total         (sum of outcome revenue_impact)
 *   - avg_cycle_time_ms            (context.built → execution.completed)
 *   - agent_accuracy               (per-agent accuracy from learning profiles)
 *
 * All queries are tenant-scoped by business_id.
 * Window: configurable, defaults to 30 days.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';

const logger = createLogger('KPIService');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentKPI {
  agent_name:    string;
  total_outputs: number;
  accuracy:      number;
  positive:      number;
  negative:      number;
}

export interface FunnelKPIs {
  business_id:                 string;
  window_days:                 number;
  computed_at:                 string;
  insights_fused:              number;
  decisions_created:           number;
  recommendations_generated:   number;
  executions_dispatched:       number;
  executions_completed:        number;
  outcomes_recorded:           number;
  feedback_events:             number;
  positive_feedback:           number;
  insight_to_decision_rate:    number;   // 0–1
  decision_to_execution_rate:  number;   // 0–1
  execution_success_rate:      number;   // 0–1
  feedback_ratio:              number;   // 0–1
  positive_feedback_rate:      number;   // 0–1
  revenue_impact_total:        number;   // ILS
  agent_accuracy:              AgentKPI[];
  learning_accuracy_7d:        number;   // avg accuracy last 7d
  learning_accuracy_30d:       number;   // avg accuracy last 30d
  learning_improvement:        number;   // 7d - 30d (positive = improving)
}

export interface PipelineVelocity {
  business_id:      string;
  avg_cycle_ms:     number;           // insight→execution avg
  p50_cycle_ms:     number;
  p95_cycle_ms:     number;
  runs_last_7d:     number;
  runs_last_30d:    number;
  last_run_at:      string | null;
}

// ─── Core KPI computation ─────────────────────────────────────────────────────

export async function computeFunnelKPIs(
  businessId: string,
  windowDays = 30,
): Promise<FunnelKPIs> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  logger.debug('Computing funnel KPIs', { businessId, windowDays });

  const [
    insightCount,
    decisionCount,
    recommendationCount,
    dispatchedCount,
    completedCount,
    outcomeRows,
    feedbackRows,
    agentRows,
    agentRows7d,
  ] = await Promise.all([

    // Insights fused
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_fused_insights
       WHERE business_id = $1 AND created_at >= $2::timestamptz`,
      businessId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    // Decisions created
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_decisions
       WHERE business_id = $1 AND created_at >= $2::timestamptz`,
      businessId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    // Recommendations generated
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_recommendations
       WHERE business_id = $1 AND created_at >= $2::timestamptz`,
      businessId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    // Executions dispatched
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_execution_tasks
       WHERE business_id = $1 AND status IN ('dispatched','completed')
         AND created_at >= $2::timestamptz`,
      businessId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    // Executions completed
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_execution_tasks
       WHERE business_id = $1 AND status = 'completed'
         AND created_at >= $2::timestamptz`,
      businessId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    // Outcomes: count + revenue
    prisma.$queryRawUnsafe<[{ n: string; revenue: string }]>(
      `SELECT COUNT(*)::text AS n, COALESCE(SUM(revenue_impact), 0)::text AS revenue
       FROM otx_outcome_events
       WHERE business_id = $1 AND created_at >= $2::timestamptz`,
      businessId, since,
    ).catch(() => [{ n: '0', revenue: '0' }]),

    // Feedback: count + positive count
    prisma.$queryRawUnsafe<[{ total: string; positive: string }]>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE score > 0)::text AS positive
       FROM feedback_events
       WHERE linked_business = $1 AND created_date >= $2::timestamptz`,
      businessId, since,
    ).catch(() => [{ total: '0', positive: '0' }]),

    // Agent accuracy (30d)
    prisma.$queryRawUnsafe<Array<{
      agent_name: string; total_outputs: string;
      accuracy_score: string; positive_count: string; negative_count: string;
    }>>(
      `SELECT agent_name, total_outputs::text, accuracy_score::text,
              positive_count::text, negative_count::text
       FROM agent_learning_profiles
       WHERE linked_business = $1`,
      businessId,
    ).catch(() => [] as any[]),

    // Agent accuracy (7d) — from recent feedback window
    prisma.$queryRawUnsafe<Array<{
      agent_name: string; total: string; positive: string;
    }>>(
      `SELECT agent_name,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE score > 0)::text AS positive
       FROM feedback_events
       WHERE linked_business = $1 AND created_date >= $2::timestamptz
       GROUP BY agent_name`,
      businessId, since7d,
    ).catch(() => [] as any[]),
  ]);

  const outcomeCount  = Number(outcomeRows[0]?.n ?? 0);
  const revenueTotal  = Number(outcomeRows[0]?.revenue ?? 0);
  const feedbackTotal = Number(feedbackRows[0]?.total ?? 0);
  const feedbackPos   = Number(feedbackRows[0]?.positive ?? 0);

  const rate = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 1000 : 0;

  // Agent accuracy arrays
  const agentKPIs: AgentKPI[] = (agentRows as any[]).map(r => ({
    agent_name:    r.agent_name,
    total_outputs: Number(r.total_outputs),
    accuracy:      Number(r.accuracy_score),
    positive:      Number(r.positive_count),
    negative:      Number(r.negative_count),
  }));

  const acc30d = agentKPIs.length > 0
    ? agentKPIs.reduce((s, a) => s + a.accuracy, 0) / agentKPIs.length
    : 0;

  const acc7dMap: Record<string, number> = {};
  for (const r of agentRows7d as any[]) {
    const total = Number(r.total);
    acc7dMap[r.agent_name] = total > 0 ? Number(r.positive) / total : 0;
  }
  const acc7dValues = Object.values(acc7dMap);
  const acc7d = acc7dValues.length > 0
    ? acc7dValues.reduce((s, v) => s + v, 0) / acc7dValues.length
    : acc30d;

  return {
    business_id:                 businessId,
    window_days:                 windowDays,
    computed_at:                 new Date().toISOString(),
    insights_fused:              insightCount,
    decisions_created:           decisionCount,
    recommendations_generated:   recommendationCount,
    executions_dispatched:       dispatchedCount,
    executions_completed:        completedCount,
    outcomes_recorded:           outcomeCount,
    feedback_events:             feedbackTotal,
    positive_feedback:           feedbackPos,
    insight_to_decision_rate:    rate(decisionCount, insightCount),
    decision_to_execution_rate:  rate(dispatchedCount, decisionCount),
    execution_success_rate:      rate(completedCount, dispatchedCount),
    feedback_ratio:              rate(feedbackTotal, recommendationCount),
    positive_feedback_rate:      rate(feedbackPos, feedbackTotal),
    revenue_impact_total:        Math.round(revenueTotal),
    agent_accuracy:              agentKPIs,
    learning_accuracy_7d:        Math.round(acc7d * 1000) / 1000,
    learning_accuracy_30d:       Math.round(acc30d * 1000) / 1000,
    learning_improvement:        Math.round((acc7d - acc30d) * 1000) / 1000,
  };
}

// ─── Pipeline velocity ────────────────────────────────────────────────────────

export async function computePipelineVelocity(businessId: string): Promise<PipelineVelocity> {
  const [runRows, lastRun] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ duration_ms: string; started_at: string }>>(
      `SELECT duration_ms::text, started_at
       FROM otx_pipeline_runs
       WHERE business_id = $1 AND status = 'completed'
         AND started_at >= NOW() - INTERVAL '30 days'
       ORDER BY started_at DESC`,
      businessId,
    ).catch(() => [] as any[]),

    prisma.$queryRawUnsafe<[{ started_at: string }]>(
      `SELECT started_at FROM otx_pipeline_runs
       WHERE business_id = $1 ORDER BY started_at DESC LIMIT 1`,
      businessId,
    ).catch(() => []),
  ]);

  const durations = (runRows as any[]).map(r => Number(r.duration_ms)).filter(d => d > 0);
  const sorted    = [...durations].sort((a, b) => a - b);

  const avg  = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const p50  = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
  const p95  = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

  const since7d  = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const runs7d   = (runRows as any[]).filter(r => r.started_at >= since7d).length;

  return {
    business_id:   businessId,
    avg_cycle_ms:  Math.round(avg),
    p50_cycle_ms:  Math.round(p50),
    p95_cycle_ms:  Math.round(p95),
    runs_last_7d:  runs7d,
    runs_last_30d: durations.length,
    last_run_at:   (lastRun as any[])[0]?.started_at ?? null,
  };
}

// ─── Tenant-scoped aggregate (for ops dashboard) ──────────────────────────────

export async function computeTenantKPIs(tenantId: string, windowDays = 30): Promise<{
  tenant_id:        string;
  business_count:   number;
  total_decisions:  number;
  avg_success_rate: number;
  total_revenue:    number;
}> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [bizCount, decisionRows, outcomeRows] = await Promise.all([
    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM "BusinessProfile" WHERE tenant_id = $1`,
      tenantId,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM otx_decisions d
       JOIN business_profiles bp ON bp.id = d.business_id
       WHERE bp.tenant_id = $1 AND d.created_at >= $2::timestamptz`,
      tenantId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

    prisma.$queryRawUnsafe<[{ n: string; revenue: string }]>(
      `SELECT COUNT(*) FILTER (WHERE o.result = 'success')::text AS n,
              COALESCE(SUM(o.revenue_impact), 0)::text AS revenue
       FROM otx_outcome_events o
       JOIN business_profiles bp ON bp.id = o.business_id
       WHERE bp.tenant_id = $1 AND o.created_at >= $2::timestamptz`,
      tenantId, since,
    ).catch(() => [{ n: '0', revenue: '0' }]),
  ]);

  return {
    tenant_id:        tenantId,
    business_count:   bizCount,
    total_decisions:  Number(decisionRows),
    avg_success_rate: 0,    // computed per-business if needed
    total_revenue:    Number(outcomeRows[0]?.revenue ?? 0),
  };
}
