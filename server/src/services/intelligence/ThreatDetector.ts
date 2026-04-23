/**
 * ThreatDetector — Intelligence Layer
 *
 * Detects business threats from signals and context.
 * Deduplicates by (business_id, type, day-window).
 *
 * Threat types:
 * - negative_review_spike:  surge in negative reviews
 * - competitor_promotion:   competitor running aggressive promotion
 * - lead_drop:              lead volume declining
 * - reputation_attack:      coordinated negative reviews or social signals
 * - price_undercut:         competitor pricing below threshold
 * - demand_drop:            forecasted demand decline
 * - service_gap:            customer complaints about unmet needs
 */

import { nanoid } from 'nanoid';
import { EnrichedContext, Threat, ThreatType, UrgencyLevel } from '../../models';
import { threatRepository } from '../../repositories/OpportunityRepository';
import { hashThreat } from '../../lib/signalHash';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';

const logger = createLogger('ThreatDetector');

const MIN_RISK_SCORE = 0.30;

interface ThreatCandidate {
  type:        ThreatType;
  risk_score:  number;
  urgency:     UrgencyLevel;
  confidence:  number;
  explanation: string;
  signal_ids:  string[];
}

// ─── Detection rules ──────────────────────────────────────────────────────────

function detectCandidates(ctx: EnrichedContext): ThreatCandidate[] {
  const candidates: ThreatCandidate[] = [];
  const signalIds = ctx.recent_signals.map(s => s.id);

  // ── negative_review_spike ─────────────────────────────────────────────────
  if (ctx.reviews.negative_last7d >= 3) {
    const isAttack = ctx.reviews.negative_last7d >= 8;
    candidates.push({
      type:        isAttack ? 'reputation_attack' : 'negative_review_spike',
      risk_score:  Math.min(1, 0.4 + ctx.reviews.negative_last7d * 0.06),
      urgency:     ctx.reviews.negative_last7d >= 8 ? 'critical' : ctx.reviews.negative_last7d >= 5 ? 'high' : 'medium',
      confidence:  0.90,
      explanation: `${ctx.reviews.negative_last7d} ביקורות שליליות ב-7 ימים האחרונים`,
      signal_ids:  signalIds.slice(0, 3),
    });
  }

  // ── competitor_promotion ──────────────────────────────────────────────────
  const aggressiveCompetitors = ctx.competitors.filter(
    c => c.trend_direction === 'rising' && (c.rating ?? 0) >= 4.2,
  );
  if (aggressiveCompetitors.length >= 1) {
    candidates.push({
      type:        'competitor_promotion',
      risk_score:  0.45 + aggressiveCompetitors.length * 0.08,
      urgency:     aggressiveCompetitors.length >= 2 ? 'high' : 'medium',
      confidence:  0.70,
      explanation: `${aggressiveCompetitors.length} מתחרים חזקים בעלייה — סכנת אובדן נתח שוק`,
      signal_ids:  signalIds.slice(0, 2),
    });
  }

  // ── lead_drop ─────────────────────────────────────────────────────────────
  if (ctx.leads.total < 5 && ctx.leads.hot === 0) {
    candidates.push({
      type:        'lead_drop',
      risk_score:  0.50,
      urgency:     'medium',
      confidence:  0.75,
      explanation: `מעט לידים פעילים (${ctx.leads.total}) — ייתכן ירידה בביקוש`,
      signal_ids:  [],
    });
  }

  // ── demand_drop (from forecasts) ───────────────────────────────────────────
  const dropForecast = ctx.forecasts.find(f => f.demand_delta_pct < -15);
  if (dropForecast) {
    candidates.push({
      type:        'demand_drop',
      risk_score:  Math.min(1, 0.4 + Math.abs(dropForecast.demand_delta_pct) / 100),
      urgency:     Math.abs(dropForecast.demand_delta_pct) > 35 ? 'high' : 'medium',
      confidence:  dropForecast.confidence,
      explanation: `ירידת ביקוש צפויה של ${Math.round(Math.abs(dropForecast.demand_delta_pct))}% בחלון ${dropForecast.forecast_window}`,
      signal_ids:  [],
    });
  }

  // ── service_gap (low health score) ────────────────────────────────────────
  if ((ctx.health_score ?? 100) < 40) {
    candidates.push({
      type:        'service_gap',
      risk_score:  Math.min(1, (40 - (ctx.health_score ?? 40)) / 40 + 0.4),
      urgency:     (ctx.health_score ?? 100) < 25 ? 'high' : 'medium',
      confidence:  0.80,
      explanation: `ציון בריאות עסקי נמוך (${ctx.health_score}/100) — דורש טיפול מיידי`,
      signal_ids:  [],
    });
  }

  // ── price_undercut (falling health + strong competitors) ─────────────────
  if (aggressiveCompetitors.length >= 2 && (ctx.health_score ?? 100) < 55) {
    candidates.push({
      type:        'price_undercut',
      risk_score:  0.55,
      urgency:     'medium',
      confidence:  0.60,
      explanation: `מתחרים חזקים עם ביצועים טובים — בדוק עמידה תחרותית במחירים`,
      signal_ids:  signalIds.slice(0, 2),
    });
  }

  return candidates.filter(c => c.risk_score >= MIN_RISK_SCORE);
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function detectThreats(
  ctx: EnrichedContext,
  traceId: string,
): Promise<Threat[]> {
  logger.info('Detecting threats', { businessId: ctx.business_id });

  const candidates = detectCandidates(ctx);
  if (candidates.length === 0) {
    logger.info('No threats detected', { businessId: ctx.business_id });
    return [];
  }

  const results: Threat[] = [];
  const now     = new Date().toISOString();
  const today   = now.slice(0, 10);

  for (const candidate of candidates) {
    const dedup_key = hashThreat(ctx.business_id, candidate.type, today);

    const threat: Threat = {
      id:               `thr_${nanoid(12)}`,
      business_id:      ctx.business_id,
      type:             candidate.type,
      source_signal_ids: candidate.signal_ids,
      risk_score:       Math.round(candidate.risk_score * 1000) / 1000,
      urgency:          candidate.urgency,
      confidence:       Math.round(candidate.confidence * 1000) / 1000,
      explanation:      candidate.explanation,
      dedup_key,
      status:           'detected',
      created_at:       now,
      updated_at:       now,
    };

    const { id, is_new } = await threatRepository.upsert(threat);
    threat.id = id;
    results.push(threat);

    await bus.emit(bus.makeEvent('threat.detected', ctx.business_id, {
      event_id:    `evt_${nanoid(8)}`,
      threat_id:   id,
      business_id: ctx.business_id,
      type:        candidate.type,
      risk_score:  threat.risk_score,
      urgency:     candidate.urgency,
      confidence:  threat.confidence,
      dedup_key,
      is_new,
    }, traceId));

    logger.info('Threat upserted', {
      id, type: candidate.type, risk_score: threat.risk_score, is_new,
    });
  }

  logger.info('Threat detection complete', {
    businessId: ctx.business_id,
    found: results.length,
  });

  return results;
}
