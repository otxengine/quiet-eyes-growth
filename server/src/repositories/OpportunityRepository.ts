/**
 * OpportunityRepository — persistence for Opportunities and Threats.
 *
 * Uses raw SQL via prisma.$executeRawUnsafe for OTX-specific tables.
 * Gracefully degrades if tables don't exist yet (pre-migration).
 *
 * DEDUP RULES:
 * - Opportunities: UNIQUE(business_id, dedup_key) → merge on conflict (update score)
 * - Threats: UNIQUE(business_id, dedup_key) → merge on conflict
 */

import { prisma } from '../db';
import { Opportunity, Threat, OpportunityStatus, ThreatStatus } from '../models';
import { canTransition, OPPORTUNITY_TRANSITIONS, THREAT_TRANSITIONS } from '../state/StateMachines';
import { createLogger } from '../infra/logger';

const logger = createLogger('OpportunityRepository');

// ─── Opportunities ─────────────────────────────────────────────────────────────

export const opportunityRepository = {

  /** Upsert opportunity — merges if dedup_key already exists for this business */
  async upsert(opp: Opportunity): Promise<{ id: string; is_new: boolean }> {
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ id: string; is_new: boolean }>>(
        `INSERT INTO otx_opportunities
           (id, business_id, type, source_signal_ids, source_event_ids, source_forecast_ids,
            opportunity_score, urgency, confidence, expected_window_start, expected_window_end,
            explanation, dedup_key, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz)
         ON CONFLICT (business_id, dedup_key) DO UPDATE SET
           opportunity_score  = GREATEST(otx_opportunities.opportunity_score, EXCLUDED.opportunity_score),
           urgency            = EXCLUDED.urgency,
           confidence         = EXCLUDED.confidence,
           explanation        = EXCLUDED.explanation,
           updated_at         = now()
         RETURNING id, (xmax = 0) AS is_new`,
        opp.id, opp.business_id, opp.type,
        opp.source_signal_ids, opp.source_event_ids, opp.source_forecast_ids,
        opp.opportunity_score, opp.urgency, opp.confidence,
        opp.expected_window_start ?? null,
        opp.expected_window_end   ?? null,
        opp.explanation, opp.dedup_key, opp.status,
        opp.created_at, opp.updated_at,
      );
      return result[0] ?? { id: opp.id, is_new: true };
    } catch (e: any) {
      if (e.message?.includes('does not exist')) return { id: opp.id, is_new: true };
      logger.error('upsert opportunity failed', { error: e.message });
      return { id: opp.id, is_new: true };
    }
  },

  /** Get active opportunities for a business (not expired/archived) */
  async getActive(businessId: string, limit = 20): Promise<Opportunity[]> {
    try {
      return await prisma.$queryRawUnsafe<Opportunity[]>(
        `SELECT * FROM otx_opportunities
         WHERE business_id = $1
           AND status NOT IN ('expired','archived')
         ORDER BY opportunity_score DESC, created_at DESC
         LIMIT $2`,
        businessId, limit,
      );
    } catch { return []; }
  },

  /** Transition opportunity state (guards against invalid transitions) */
  async transition(id: string, from: OpportunityStatus, to: OpportunityStatus): Promise<void> {
    if (!canTransition(OPPORTUNITY_TRANSITIONS, from, to)) {
      logger.warn('Invalid opportunity transition', { id, from, to });
      return;
    }
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE otx_opportunities SET status = $1, updated_at = now()
         WHERE id = $2 AND status = $3`,
        to, id, from,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  },

  /** Expire opportunities past their window end */
  async expireStale(businessId: string): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE otx_opportunities
         SET status = 'expired', updated_at = now()
         WHERE business_id = $1
           AND status NOT IN ('expired','archived','decided','recommended')
           AND expected_window_end < now()`,
        businessId,
      );
    } catch { /* table may not exist */ }
  },
};

// ─── Threats ───────────────────────────────────────────────────────────────────

export const threatRepository = {

  /** Upsert threat — merges if dedup_key already exists for this business */
  async upsert(threat: Threat): Promise<{ id: string; is_new: boolean }> {
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ id: string; is_new: boolean }>>(
        `INSERT INTO otx_threats
           (id, business_id, type, source_signal_ids, risk_score, urgency, confidence,
            explanation, dedup_key, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)
         ON CONFLICT (business_id, dedup_key) DO UPDATE SET
           risk_score   = GREATEST(otx_threats.risk_score, EXCLUDED.risk_score),
           urgency      = EXCLUDED.urgency,
           confidence   = EXCLUDED.confidence,
           explanation  = EXCLUDED.explanation,
           updated_at   = now()
         RETURNING id, (xmax = 0) AS is_new`,
        threat.id, threat.business_id, threat.type,
        threat.source_signal_ids, threat.risk_score,
        threat.urgency, threat.confidence, threat.explanation,
        threat.dedup_key, threat.status,
        threat.created_at, threat.updated_at,
      );
      return result[0] ?? { id: threat.id, is_new: true };
    } catch (e: any) {
      if (e.message?.includes('does not exist')) return { id: threat.id, is_new: true };
      logger.error('upsert threat failed', { error: e.message });
      return { id: threat.id, is_new: true };
    }
  },

  /** Get active threats for a business */
  async getActive(businessId: string, limit = 10): Promise<Threat[]> {
    try {
      return await prisma.$queryRawUnsafe<Threat[]>(
        `SELECT * FROM otx_threats
         WHERE business_id = $1
           AND status NOT IN ('mitigated','expired','archived')
         ORDER BY risk_score DESC, created_at DESC
         LIMIT $2`,
        businessId, limit,
      );
    } catch { return []; }
  },

  /** Transition threat state */
  async transition(id: string, from: ThreatStatus, to: ThreatStatus): Promise<void> {
    if (!canTransition(THREAT_TRANSITIONS, from, to)) {
      logger.warn('Invalid threat transition', { id, from, to });
      return;
    }
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE otx_threats SET status = $1, updated_at = now()
         WHERE id = $2 AND status = $3`,
        to, id, from,
      );
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }
  },
};
