/**
 * DecisionRepository — stores and retrieves Decisions, FusedInsights, Recommendations.
 *
 * These are stored in the otx_decisions, otx_fused_insights, and otx_recommendations
 * tables (created by migration). Gracefully falls back if tables don't exist yet.
 */

import { prisma } from '../db';
import { Decision, FusedInsight, Recommendation, ExecutionTask } from '../models';

// ─── FusedInsight ─────────────────────────────────────────────────────────────

export class DecisionRepository {
  async saveFusedInsight(insight: FusedInsight): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_fused_insights
          (id, business_id, trace_id, top_opportunity, urgency, confidence,
           expected_impact, explanation, contributing_signal_ids,
           raw_signals_count, trends_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9::jsonb,$10::int,$11::int,$12::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        insight.id,
        insight.business_id,
        insight.trace_id,
        insight.top_opportunity,
        insight.urgency,
        insight.confidence,
        insight.expected_impact,
        insight.explanation,
        JSON.stringify(insight.contributing_signals),
        insight.raw_signals_count,
        insight.trends_count,
        insight.created_at,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
      // Table not yet migrated — skip silently
    }
  }

  async getRecentInsights(businessId: string, limit = 5): Promise<FusedInsight[]> {
    try {
      const rows = await prisma.$queryRawUnsafe<FusedInsight[]>(
        `SELECT * FROM otx_fused_insights
         WHERE business_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        businessId, limit,
      );
      return rows;
    } catch { return []; }
  }

  // ─── Decision ───────────────────────────────────────────────────────────────

  async saveDecision(decision: Decision): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_decisions
          (id, business_id, insight_id, trace_id, action_type, title, reasoning,
           priority, score, score_breakdown, confidence, expected_roi,
           execution_mode, tags, context_snapshot, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,$9::numeric,$10::jsonb,$11::numeric,
                 $12::numeric,$13,$14::jsonb,$15,$16::timestamptz,$17::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        decision.id,
        decision.business_id,
        decision.insight_id,
        decision.trace_id,
        decision.action_type,
        decision.title,
        decision.reasoning,
        decision.priority,
        Math.round(decision.score),
        JSON.stringify(decision.score_breakdown),
        decision.confidence,
        decision.expected_roi,
        decision.execution_mode,
        JSON.stringify(decision.tags),
        decision.context_snapshot,
        decision.created_at,
        decision.expires_at,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  }

  async getRecentDecisions(businessId: string, limit = 10): Promise<Decision[]> {
    try {
      return prisma.$queryRawUnsafe<Decision[]>(
        `SELECT * FROM otx_decisions
         WHERE business_id = $1 AND expires_at > NOW()
         ORDER BY score DESC, created_at DESC
         LIMIT $2`,
        businessId, limit,
      );
    } catch { return []; }
  }

  async getDecisionById(id: string): Promise<Decision | null> {
    try {
      const rows = await prisma.$queryRawUnsafe<Decision[]>(
        `SELECT * FROM otx_decisions WHERE id = $1 LIMIT 1`,
        id,
      );
      return rows[0] ?? null;
    } catch { return null; }
  }

  // ─── Recommendation ──────────────────────────────────────────────────────────

  async saveRecommendation(rec: Recommendation): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_recommendations
          (id, business_id, decision_id, trace_id, title, body, cta,
           channel, urgency, estimated_impact, action_steps,
           draft_content, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        rec.id,
        rec.business_id,
        rec.decision_id,
        rec.trace_id,
        rec.title,
        rec.body,
        rec.cta,
        rec.channel,
        rec.urgency,
        rec.estimated_impact,
        JSON.stringify(rec.action_steps),
        rec.draft_content ?? null,
        rec.created_at,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  }

  async getRecentRecommendations(businessId: string, limit = 10): Promise<Recommendation[]> {
    try {
      return prisma.$queryRawUnsafe<Recommendation[]>(
        `SELECT * FROM otx_recommendations
         WHERE business_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        businessId, limit,
      );
    } catch { return []; }
  }

  // ─── Execution tasks ──────────────────────────────────────────────────────────

  async saveTask(task: ExecutionTask): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_execution_tasks
          (id, decision_id, business_id, task_type, channel, payload,
           status, attempts, max_attempts, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::int,$9::int,$10::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        task.id,
        task.decision_id,
        task.business_id,
        task.task_type,
        task.channel,
        JSON.stringify(task.payload),
        task.status,
        task.attempts,
        task.max_attempts,
        task.created_at,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  }

  async updateTaskStatus(
    id: string,
    status: string,
    error?: string,
  ): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE otx_execution_tasks
         SET status = $2,
             completed_at = NOW(),
             error = $3
         WHERE id = $1`,
        id, status, error ?? null,
      );
    } catch {}
  }

  // ─── Pipeline run log ─────────────────────────────────────────────────────────

  async savePipelineRun(runId: string, businessId: string, summary: Record<string, any>): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_pipeline_runs
          (id, business_id, trace_id, mode, triggered_by, status, summary, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,NOW())
         ON CONFLICT (id) DO UPDATE SET
           status      = EXCLUDED.status,
           summary     = EXCLUDED.summary,
           completed_at = NOW()`,
        runId,
        businessId,
        summary.trace_id ?? runId,
        summary.mode ?? 'full',
        summary.triggered_by ?? 'manual',
        summary.status ?? 'completed',
        JSON.stringify(summary),
        summary.started_at ?? new Date().toISOString(),
      );
    } catch {}
  }
}

export const decisionRepository = new DecisionRepository();
