/**
 * LearningRepository — reads/writes all learning-layer data.
 * Covers: feedback events, outcome events, business memory, agent profiles,
 * learning signals, policy weights.
 */

import { prisma } from '../db';
import { OutcomeEvent, PolicyWeight } from '../models';

export class LearningRepository {
  // ─── Feedback ────────────────────────────────────────────────────────────────

  async getRecentFeedback(businessId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    return prisma.feedbackEvent.findMany({
      where: { linked_business: businessId, created_date: { gte: since } },
      orderBy: { created_date: 'desc' },
    });
  }

  async getFeedbackByAgent(businessId: string, agentName: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    return prisma.feedbackEvent.findMany({
      where: {
        linked_business: businessId,
        agent_name: agentName,
        created_date: { gte: since },
      },
    });
  }

  // ─── Outcome events ───────────────────────────────────────────────────────────

  async saveOutcome(outcome: OutcomeEvent): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_outcome_events
          (id, decision_id, business_id, agent_name, result, revenue_impact, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        outcome.id,
        outcome.decision_id,
        outcome.business_id,
        outcome.agent_name,
        outcome.result,
        outcome.revenue_impact,
        outcome.notes,
        outcome.timestamp,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  }

  async getOutcomesByDecision(decisionId: string): Promise<OutcomeEvent[]> {
    try {
      return prisma.$queryRawUnsafe<OutcomeEvent[]>(
        `SELECT * FROM otx_outcome_events WHERE decision_id = $1`,
        decisionId,
      );
    } catch { return []; }
  }

  async getOutcomeSuccessRate(businessId: string, agentName: string): Promise<number> {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ success_rate: number }>>(
        `SELECT
           COALESCE(
             COUNT(*) FILTER (WHERE result = 'success')::float / NULLIF(COUNT(*),0),
             0.5
           ) AS success_rate
         FROM otx_outcome_events
         WHERE business_id = $1 AND agent_name = $2`,
        businessId, agentName,
      );
      return rows[0]?.success_rate ?? 0.5;
    } catch { return 0.5; }
  }

  // ─── Agent learning profiles ──────────────────────────────────────────────────

  async getAgentProfile(businessId: string, agentName: string) {
    return prisma.agentLearningProfile.findFirst({
      where: { linked_business: businessId, agent_name: agentName },
    });
  }

  async getAllAgentProfiles(businessId: string) {
    return prisma.agentLearningProfile.findMany({
      where: { linked_business: businessId },
    });
  }

  async upsertAgentProfile(
    businessId: string,
    agentName: string,
    update: {
      total_outputs: number;
      positive_count: number;
      negative_count: number;
      accuracy_score: number;
      rejected_types: string;
      accepted_types: string;
    },
  ) {
    return prisma.agentLearningProfile.upsert({
      where: { linked_business_agent_name: { linked_business: businessId, agent_name: agentName } },
      create: { linked_business: businessId, agent_name: agentName, ...update, last_updated: new Date().toISOString() },
      update: { ...update, last_updated: new Date().toISOString() },
    });
  }

  // ─── Business memory ──────────────────────────────────────────────────────────

  async getMemory(businessId: string) {
    return prisma.businessMemory.findUnique({ where: { linked_business: businessId } });
  }

  async upsertMemory(businessId: string, data: Record<string, any>) {
    const existing = await prisma.businessMemory.findUnique({ where: { linked_business: businessId } });
    if (existing) {
      return prisma.businessMemory.update({ where: { id: existing.id }, data });
    }
    return prisma.businessMemory.create({ data: { linked_business: businessId, ...data } });
  }

  // ─── Learning signals / patterns ─────────────────────────────────────────────

  async getTopPatterns(businessId: string, limit = 30) {
    return prisma.learningSignal.findMany({
      where: { linked_business: businessId },
      orderBy: { occurrence_count: 'desc' },
      take: limit,
    });
  }

  async upsertPattern(
    businessId: string,
    patternKey: string,
    label: string,
    signalType: string,
    agentName: string,
    weightDelta: number,
  ) {
    const existing = await prisma.learningSignal.findFirst({
      where: { linked_business: businessId, pattern_key: patternKey },
    });
    if (existing) {
      return prisma.learningSignal.update({
        where: { id: existing.id },
        data: {
          occurrence_count: (existing.occurrence_count ?? 0) + 1,
          weight: Math.max(-1, Math.min(1, (existing.weight ?? 0) + weightDelta)),
          last_seen: new Date().toISOString(),
        },
      });
    }
    return prisma.learningSignal.create({
      data: {
        linked_business:  businessId,
        pattern_key:      patternKey,
        pattern_label:    label,
        signal_type:      signalType,
        agent_name:       agentName,
        weight:           weightDelta,
        occurrence_count: 1,
        last_seen:        new Date().toISOString(),
      },
    });
  }

  // ─── Policy weights ───────────────────────────────────────────────────────────

  async savePolicyWeight(pw: PolicyWeight): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_policy_weights
          (agent_name, action_type, business_id, weight, success_rate,
           sample_size, last_updated, policy_version)
         VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::int,$7::timestamptz,$8::int)
         ON CONFLICT (agent_name, action_type, business_id)
         DO UPDATE SET
           weight         = EXCLUDED.weight,
           success_rate   = EXCLUDED.success_rate,
           sample_size    = EXCLUDED.sample_size,
           last_updated   = EXCLUDED.last_updated,
           policy_version = EXCLUDED.policy_version`,
        pw.agent_name,
        pw.action_type,
        (pw as any).business_id ?? 'global',
        pw.weight,
        pw.success_rate,
        pw.sample_size,
        pw.last_updated,
        pw.policy_version,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  }

  async getPolicyWeight(businessId: string, agentName: string, actionType: string): Promise<number> {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ weight: number }>>(
        `SELECT weight FROM otx_policy_weights
         WHERE (business_id = $1 OR business_id = 'global')
           AND agent_name = $2 AND action_type = $3
         ORDER BY CASE WHEN business_id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        businessId, agentName, actionType,
      );
      return rows[0]?.weight ?? 0.5;
    } catch { return 0.5; }
  }
}

export const learningRepository = new LearningRepository();
