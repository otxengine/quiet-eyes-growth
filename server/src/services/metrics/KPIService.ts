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
  has_winner_dna:              boolean;  // AC4: business has DNA after 3+ wins
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
    winnerDnaRow,
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

    // AC4 (KAN-94): business has winner DNA after 3+ wins
    prisma.$queryRawUnsafe<[{ has_dna: string }]>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM sector_knowledge sk
           JOIN business_profiles bp ON bp.category = sk.sector AND bp.city = sk.region
           WHERE bp.id = $1 AND sk.winner_lead_dna IS NOT NULL
         )
         AND (SELECT COUNT(*) FROM leads WHERE linked_business = $1 AND status = 'closed_won') >= 3
       )::text AS has_dna`,
      businessId,
    ).catch(() => [{ has_dna: 'false' }]),
  ]);

  const hasWinnerDna  = (winnerDnaRow as any[])[0]?.has_dna === 'true';
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
    has_winner_dna:              hasWinnerDna,
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

// ─── Analysis observability (KAN-72) ─────────────────────────────────────────

export interface AnalysisObservability {
  business_id:               string;
  window_days:               number;
  computed_at:               string;
  // AC1: conversion + cold-start
  synthesis_runs_total:      number;
  synthesis_conversion_rate: number;   // % runs with items_processed > 0
  cold_start_runs:           number;
  cold_start_rate:           number;   // % market_signal events with cold_start=true
  // AC2: avg MarketSignal confidence
  avg_signal_confidence:     number;
  signals_in_window:         number;
  // AC3: competitor coverage
  competitor_count:          number;
  has_coverage:              boolean;  // >= 3 competitors
  // AC4: pipeline health via otx_pipeline_runs
  pipeline_runs_total:       number;
  pipeline_completion_rate:  number;   // % status='completed'
  avg_insights_created:      number;
  avg_opportunities_found:   number;
  avg_threats_found:         number;
  // AC5: freshness gap
  last_synthesis_at:         string | null;
  last_orchestrator_at:      string | null;
  freshness_gap_hours:       number | null;  // positive = synthesis is newer
}

export async function computeAnalysisObservability(
  businessId: string,
  windowDays = 30,
): Promise<AnalysisObservability> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  logger.debug('Computing analysis observability', { businessId, windowDays });

  const [synthRows, coldRows, confidenceRows, competitorCount, pipelineRows, lastOrch] =
    await Promise.all([

      // AC1a + AC5a: synthesis conversion + last run time — automation_logs
      prisma.$queryRawUnsafe<Array<{ total: string; converted: string; last_run: string | null }>>(
        `SELECT
           COUNT(*)::text                                              AS total,
           COUNT(*) FILTER (WHERE items_processed > 0)::text          AS converted,
           MAX(start_time)                                             AS last_run
         FROM automation_logs
         WHERE linked_business = $1
           AND automation_name = 'synthesizeMarketInsights'
           AND start_time >= $2`,
        businessId, since,
      ).catch(() => [{ total: '0', converted: '0', last_run: null }]),

      // AC1b: cold-start rate — system_events
      prisma.$queryRawUnsafe<Array<{ total: string; cold_starts: string }>>(
        `SELECT
           COUNT(*)::text                                                             AS total,
           COUNT(*) FILTER (WHERE context_attrs LIKE '%"cold_start":true%')::text    AS cold_starts
         FROM system_events
         WHERE business_id = $1
           AND event_type = 'market_signal'
           AND created_at >= $2::timestamptz`,
        businessId, since,
      ).catch(() => [{ total: '0', cold_starts: '0' }]),

      // AC2: avg MarketSignal confidence — market_signals
      prisma.$queryRawUnsafe<Array<{ avg_conf: string | null; total: string }>>(
        `SELECT
           ROUND(AVG(confidence)::numeric, 2)::text AS avg_conf,
           COUNT(*)::text                           AS total
         FROM market_signals
         WHERE linked_business = $1
           AND detected_at >= $2`,
        businessId, since,
      ).catch(() => [{ avg_conf: null, total: '0' }]),

      // AC3: competitor count — competitors
      prisma.$queryRawUnsafe<[{ n: string }]>(
        `SELECT COUNT(*)::text AS n FROM competitors WHERE linked_business = $1`,
        businessId,
      ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),

      // AC4: pipeline health — otx_pipeline_runs
      prisma.$queryRawUnsafe<Array<{
        total: string; completed: string;
        avg_insights: string | null; avg_opps: string | null; avg_threats: string | null;
      }>>(
        `SELECT
           COUNT(*)::text                                              AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::text         AS completed,
           ROUND(AVG(insights_created)::numeric, 2)::text             AS avg_insights,
           ROUND(AVG(opportunities_found)::numeric, 2)::text          AS avg_opps,
           ROUND(AVG(threats_found)::numeric, 2)::text                AS avg_threats
         FROM otx_pipeline_runs
         WHERE business_id = $1
           AND started_at >= $2::timestamptz`,
        businessId, since,
      ).catch(() => [{ total: '0', completed: '0', avg_insights: null, avg_opps: null, avg_threats: null }]),

      // AC5b: last orchestrator run time (all-time, not windowed)
      prisma.$queryRawUnsafe<[{ last_run: string | null }]>(
        `SELECT MAX(started_at)::text AS last_run FROM otx_pipeline_runs WHERE business_id = $1`,
        businessId,
      ).catch(() => [{ last_run: null }]),
    ]);

  const synthTotal     = Number((synthRows as any[])[0]?.total     ?? 0);
  const synthConverted = Number((synthRows as any[])[0]?.converted ?? 0);
  const lastSynthAt    = (synthRows as any[])[0]?.last_run ?? null;

  const coldTotal  = Number((coldRows as any[])[0]?.total       ?? 0);
  const coldStarts = Number((coldRows as any[])[0]?.cold_starts ?? 0);

  const avgConf      = parseFloat((confidenceRows as any[])[0]?.avg_conf ?? '0') || 0;
  const signalCount  = Number((confidenceRows as any[])[0]?.total ?? 0);

  const pipeTotal     = Number((pipelineRows as any[])[0]?.total      ?? 0);
  const pipeCompleted = Number((pipelineRows as any[])[0]?.completed  ?? 0);
  const avgInsights   = parseFloat((pipelineRows as any[])[0]?.avg_insights ?? '0') || 0;
  const avgOpps       = parseFloat((pipelineRows as any[])[0]?.avg_opps     ?? '0') || 0;
  const avgThreats    = parseFloat((pipelineRows as any[])[0]?.avg_threats  ?? '0') || 0;

  const rawOrchAt  = (lastOrch as any[])[0]?.last_run ?? null;
  const lastOrchAt = rawOrchAt ? new Date(rawOrchAt).toISOString() : null;

  let freshnessGapHours: number | null = null;
  if (lastSynthAt && lastOrchAt) {
    freshnessGapHours = Math.round(
      (new Date(lastSynthAt).getTime() - new Date(lastOrchAt).getTime()) / 3_600_000 * 10,
    ) / 10;
  }

  const rate = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 1000 : 0;

  return {
    business_id:               businessId,
    window_days:               windowDays,
    computed_at:               new Date().toISOString(),
    synthesis_runs_total:      synthTotal,
    synthesis_conversion_rate: rate(synthConverted, synthTotal),
    cold_start_runs:           coldStarts,
    cold_start_rate:           rate(coldStarts, coldTotal),
    avg_signal_confidence:     avgConf,
    signals_in_window:         signalCount,
    competitor_count:          competitorCount as number,
    has_coverage:              (competitorCount as number) >= 3,
    pipeline_runs_total:       pipeTotal,
    pipeline_completion_rate:  rate(pipeCompleted, pipeTotal),
    avg_insights_created:      avgInsights,
    avg_opportunities_found:   avgOpps,
    avg_threats_found:         avgThreats,
    last_synthesis_at:         lastSynthAt,
    last_orchestrator_at:      lastOrchAt,
    freshness_gap_hours:       freshnessGapHours,
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

// ─── About-enrichment funnel (KAN-208, PRD 15 Phase D) ────────────────────────

export interface AboutMetrics {
  tenant_id:            string;
  window_days:          number;
  computed_at:          string;
  approved_count:       number;
  rejected_count:       number;
  approve_rate:         number;   // approved / (approved + rejected)
  edited_count:         number;
  edit_rate:            number;   // edited / approved — owner changed the draft before approving
  source_covered_count: number;
  source_coverage_rate: number;   // approved with >=1 non-seed source / approved
  blocked_count:        number;
  generated_count:      number;
  empty_block_rate:     number;   // blocked / (blocked + generated) — should be low
}

export async function computeAboutMetrics(tenantId: string, windowDays = 30): Promise<AboutMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [rows, blockedCount] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ about_status: string; about_sources: string | null; about_draft: string | null; about_approved: string | null }>>(
      `SELECT about_status, about_sources, about_draft, about_approved
       FROM "business_profiles"
       WHERE tenant_id = $1
         AND about_status IN ('approved', 'rejected')
         AND (about_approved_at >= $2 OR about_generated_at >= $2)`,
      tenantId, since,
    ).catch(() => []),

    prisma.$queryRawUnsafe<[{ n: string }]>(
      `SELECT COUNT(*)::text AS n FROM automation_logs al
       JOIN business_profiles bp ON bp.id = al.linked_business
       WHERE bp.tenant_id = $1 AND al.automation_name = 'about_blocked' AND al.created_date >= $2::timestamptz`,
      tenantId, since,
    ).then(r => Number(r[0]?.n ?? 0)).catch(() => 0),
  ]);

  const approved = rows.filter(r => r.about_status === 'approved');
  const rejected = rows.filter(r => r.about_status === 'rejected');

  // Edit rate compares the last-generated draft to what got approved. Note: about_draft is
  // overwritten by a later regenerate, so a profile that regenerated again post-approval
  // reads as "not edited" here even if the original approval was edited.
  const edited = approved.filter(r => {
    if (!r.about_draft || !r.about_approved) return false;
    try { return JSON.stringify(JSON.parse(r.about_draft)) !== JSON.stringify(JSON.parse(r.about_approved)); }
    catch { return false; }
  }).length;

  const sourceCovered = approved.filter(r => {
    try {
      const sources: string[] = r.about_sources ? JSON.parse(r.about_sources) : [];
      return sources.some(s => s !== 'seed_info');
    } catch { return false; }
  }).length;

  const generatedCount = rows.length; // every approved/rejected row was generated at least once

  return {
    tenant_id:            tenantId,
    window_days:          windowDays,
    computed_at:          new Date().toISOString(),
    approved_count:       approved.length,
    rejected_count:       rejected.length,
    approve_rate:         rows.length ? approved.length / rows.length : 0,
    edited_count:         edited,
    edit_rate:            approved.length ? edited / approved.length : 0,
    source_covered_count: sourceCovered,
    source_coverage_rate: approved.length ? sourceCovered / approved.length : 0,
    blocked_count:        blockedCount,
    generated_count:      generatedCount,
    empty_block_rate:     (blockedCount + generatedCount) ? blockedCount / (blockedCount + generatedCount) : 0,
  };
}

// ─── Competitor-discovery funnel (KAN-216, PRD 16 Phase C) ────────────────────

// ponytail: inline from src/lib/planConfig.js — update both if plan limits change
const PLAN_COMPETITOR_LIMITS: Record<string, number> = {
  free_trial: 3, free: 3, starter: 5, growth: 10, pro: Infinity, enterprise: Infinity,
};
// ponytail: static per-run budget; move to a per-plan value in planConfig.js if that's ever needed
const DATAFORSEO_BUDGET_USD_PER_RUN = 0.05;

export interface CompetitorDiscoveryMetrics {
  tenant_id:              string;
  window_days:            number;
  computed_at:            string;
  identified_count:       number;
  kept_count:             number;
  precision:              number;   // kept (not marked not-relevant) / identified
  scan_count:             number;
  median_rivals_per_scan: number;
  avg_cap_utilization:    number;   // avg(items_processed / plan cap), finite-cap plans only
  both_sources_count:     number;
  one_source_count:       number;
  source_mix_rate:        number;   // seen-by-both / (seen-by-both + seen-by-one)
  total_cost_usd:         number;
  avg_cost_per_run_usd:   number;
  budget_usd_per_run:     number;
  over_budget_rate:       number;   // runs costing over budget / runs with cost recorded
  empty_scan_count:       number;
  empty_rate:             number;   // scans with zero candidates / total scans
}

export async function computeCompetitorDiscoveryMetrics(tenantId: string, windowDays = 30): Promise<CompetitorDiscoveryMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  type CompetitorRow = { not_relevant: boolean | null; discovery_sources: string | null };
  type RunRow = { items_processed: number | null; cost_usd: number | null; plan_id: string | null };

  const [competitorRows, runRows] = await Promise.all([
    prisma.$queryRawUnsafe<CompetitorRow[]>(
      `SELECT c.not_relevant, c.discovery_sources
       FROM competitors c
       JOIN business_profiles bp ON bp.id = c.linked_business
       WHERE bp.tenant_id = $1 AND c.created_date >= $2::timestamptz`,
      tenantId, since,
    ).catch((): CompetitorRow[] => []),

    prisma.$queryRawUnsafe<RunRow[]>(
      `SELECT al.items_processed, al.cost_usd, bp.plan_id
       FROM automation_logs al
       JOIN business_profiles bp ON bp.id = al.linked_business
       WHERE bp.tenant_id = $1 AND al.automation_name = 'runCompetitorIdentification'
         AND al.status = 'success' AND al.created_date >= $2::timestamptz`,
      tenantId, since,
    ).catch((): RunRow[] => []),
  ]);

  const identified = competitorRows.length;
  const kept = competitorRows.filter(c => !c.not_relevant).length;

  const sourcesOf = (r: { discovery_sources: string | null }): string[] => {
    try { return r.discovery_sources ? JSON.parse(r.discovery_sources) : []; } catch { return []; }
  };
  const bothSources = competitorRows.filter(c => sourcesOf(c).length >= 2).length;
  const oneSource   = competitorRows.filter(c => sourcesOf(c).length === 1).length;

  const scanCount = runRows.length;
  const itemCounts = runRows.map(r => Number(r.items_processed ?? 0)).sort((a, b) => a - b);
  const median = itemCounts.length
    ? (itemCounts.length % 2
        ? itemCounts[(itemCounts.length - 1) / 2]
        : (itemCounts[itemCounts.length / 2 - 1] + itemCounts[itemCounts.length / 2]) / 2)
    : 0;

  const capUtilizations = runRows
    .map(r => ({ items: Number(r.items_processed ?? 0), cap: PLAN_COMPETITOR_LIMITS[r.plan_id || 'free_trial'] ?? 3 }))
    .filter(r => Number.isFinite(r.cap) && r.cap > 0)
    .map(r => r.items / r.cap);
  const avgCapUtilization = capUtilizations.length ? capUtilizations.reduce((a, b) => a + b, 0) / capUtilizations.length : 0;

  const totalCost = runRows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  const costRunsRecorded = runRows.filter(r => r.cost_usd != null);
  const overBudget = costRunsRecorded.filter(r => Number(r.cost_usd) > DATAFORSEO_BUDGET_USD_PER_RUN).length;

  const emptyScans = runRows.filter(r => Number(r.items_processed ?? 0) === 0).length;

  return {
    tenant_id:              tenantId,
    window_days:            windowDays,
    computed_at:            new Date().toISOString(),
    identified_count:       identified,
    kept_count:             kept,
    precision:              identified ? kept / identified : 0,
    scan_count:             scanCount,
    median_rivals_per_scan: median,
    avg_cap_utilization:    avgCapUtilization,
    both_sources_count:     bothSources,
    one_source_count:       oneSource,
    source_mix_rate:        (bothSources + oneSource) ? bothSources / (bothSources + oneSource) : 0,
    total_cost_usd:         totalCost,
    avg_cost_per_run_usd:   scanCount ? totalCost / scanCount : 0,
    budget_usd_per_run:     DATAFORSEO_BUDGET_USD_PER_RUN,
    over_budget_rate:       costRunsRecorded.length ? overBudget / costRunsRecorded.length : 0,
    empty_scan_count:       emptyScans,
    empty_rate:             scanCount ? emptyScans / scanCount : 0,
  };
}

// ─── URL-enrichment funnel (KAN-224, PRD 17 Phase C) ──────────────────────────

export interface UrlEnrichmentMetrics {
  tenant_id:                    string;
  window_days:                  number;
  computed_at:                  string;
  identified_count:             number;
  website_filled_count:         number;
  website_fill_rate_24h:        number;  // AC1: website_url set within 24h of identify / identified
  social_fill_count:            number;  // AC2: social fields auto-filled (have a *_source tag)
  social_from_site_extract:     number;
  social_from_site_extract_rate: number; // AC2: site-extract share of social fills vs SERP/Tavily
  auto_filled_field_count:      number;  // AC3: fields any source auto-filled
  auto_filled_kept_count:       number;  // fields still not in manual_url_fields (owner didn't edit/clear)
  precision:                    number;  // AC3
  empty_social_count:           number;
  empty_social_rate:            number;  // AC4
  run_count:                    number;
  failed_run_count:             number;
  failed_run_rate:              number;  // AC5
}

export async function computeUrlEnrichmentMetrics(tenantId: string, windowDays = 30): Promise<UrlEnrichmentMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  type CompetitorRow = {
    created_date: string;
    website_url: string | null; website_url_source: string | null;
    instagram_url: string | null; instagram_url_source: string | null;
    facebook_url: string | null; facebook_url_source: string | null;
    tiktok_url: string | null; tiktok_url_source: string | null;
    social_pages_crawled_at: string | null;
    manual_url_fields: string[] | null;
  };
  type RunRow = { status: string | null };

  const [rows, runRows] = await Promise.all([
    prisma.$queryRawUnsafe<CompetitorRow[]>(
      `SELECT c.created_date, c.website_url, c.website_url_source,
              c.instagram_url, c.instagram_url_source,
              c.facebook_url, c.facebook_url_source,
              c.tiktok_url, c.tiktok_url_source,
              c.social_pages_crawled_at, c.manual_url_fields
       FROM competitors c
       JOIN business_profiles bp ON bp.id = c.linked_business
       WHERE bp.tenant_id = $1 AND c.created_date >= $2::timestamptz`,
      tenantId, since,
    ).catch((): CompetitorRow[] => []),

    prisma.$queryRawUnsafe<RunRow[]>(
      `SELECT al.status
       FROM automation_logs al
       JOIN business_profiles bp ON bp.id = al.linked_business
       WHERE bp.tenant_id = $1 AND al.automation_name IN ('enrichCompetitorUrls', 'enrichCompetitorUrlsScheduled')
         AND al.created_date >= $2::timestamptz`,
      tenantId, since,
    ).catch((): RunRow[] => []),
  ]);

  const identified = rows.length;
  const websiteFilled = rows.filter(r => r.website_url).length;
  const websiteFilledWithin24h = rows.filter(r => {
    if (!r.website_url) return false;
    if (!r.social_pages_crawled_at) return true; // set at identify time itself (e.g. Places match on creation)
    const ms = new Date(r.social_pages_crawled_at).getTime() - new Date(r.created_date).getTime();
    return ms <= 24 * 60 * 60 * 1000;
  }).length;

  const FIELDS: [string, keyof CompetitorRow][] = [
    ['website_url', 'website_url_source'],
    ['instagram_url', 'instagram_url_source'],
    ['facebook_url', 'facebook_url_source'],
    ['tiktok_url', 'tiktok_url_source'],
  ];
  const SOCIAL_FIELDS = FIELDS.slice(1);

  let autoFilledTotal = 0, autoFilledKept = 0;
  let socialFillCount = 0, socialFromSiteExtract = 0;
  for (const r of rows) {
    const manual = r.manual_url_fields ?? [];
    for (const [field, srcField] of FIELDS) {
      const source = r[srcField] as string | null;
      if (!source) continue;
      autoFilledTotal++;
      if (!manual.includes(field)) autoFilledKept++;
    }
    for (const [, srcField] of SOCIAL_FIELDS) {
      const source = r[srcField] as string | null;
      if (!source) continue;
      socialFillCount++;
      if (source === 'site_extract') socialFromSiteExtract++;
    }
  }

  const emptySocial = rows.filter(r => !r.instagram_url && !r.facebook_url && !r.tiktok_url).length;

  const runCount = runRows.length;
  const failedRuns = runRows.filter(r => r.status === 'failed').length;

  return {
    tenant_id:                     tenantId,
    window_days:                   windowDays,
    computed_at:                   new Date().toISOString(),
    identified_count:              identified,
    website_filled_count:          websiteFilled,
    website_fill_rate_24h:         identified ? websiteFilledWithin24h / identified : 0,
    social_fill_count:             socialFillCount,
    social_from_site_extract:      socialFromSiteExtract,
    social_from_site_extract_rate: socialFillCount ? socialFromSiteExtract / socialFillCount : 0,
    auto_filled_field_count:       autoFilledTotal,
    auto_filled_kept_count:        autoFilledKept,
    precision:                     autoFilledTotal ? autoFilledKept / autoFilledTotal : 0,
    empty_social_count:            emptySocial,
    empty_social_rate:             identified ? emptySocial / identified : 0,
    run_count:                     runCount,
    failed_run_count:              failedRuns,
    failed_run_rate:               runCount ? failedRuns / runCount : 0,
  };
}
