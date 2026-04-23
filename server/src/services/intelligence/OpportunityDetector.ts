/**
 * OpportunityDetector — Intelligence Layer
 *
 * Detects business opportunities from classified signals, forecasts, and context.
 * Deduplicates by (business_id, type, day-window).
 * Merges existing opportunities instead of creating duplicates.
 *
 * Opportunity types detected:
 * - demand_spike:         forecasted or signal-driven demand increase
 * - competitor_gap:       competitor weakness detected
 * - seasonal_window:      calendar-based opportunity (holiday, event)
 * - local_event:          nearby event with footfall impact
 * - reputation_recovery:  reviews trending positive after a dip
 * - lead_surge:           hot leads accumulating without follow-up
 * - retention_risk:       churn signals — convert to retention opportunity
 * - pricing_opportunity:  market allows price optimization
 * - expansion_signal:     signals pointing to new service demand
 */

import { nanoid } from 'nanoid';
import { EnrichedContext, Opportunity, OpportunityType, UrgencyLevel } from '../../models';
import { opportunityRepository } from '../../repositories/OpportunityRepository';
import { hashOpportunity } from '../../lib/signalHash';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';

const logger = createLogger('OpportunityDetector');

// Minimum score to qualify an opportunity
const MIN_OPPORTUNITY_SCORE = 0.35;

interface DetectionCandidate {
  type:           OpportunityType;
  score:          number;
  urgency:        UrgencyLevel;
  confidence:     number;
  explanation:    string;
  signal_ids:     string[];
  window_days:    number;            // how many days ahead this opportunity is relevant
}

// ─── Detection rules ──────────────────────────────────────────────────────────

function detectCandidates(ctx: EnrichedContext): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];
  const signalIds = ctx.recent_signals.map(s => s.id);

  // ── lead_surge ─────────────────────────────────────────────────────────────
  if (ctx.leads.hot >= 3) {
    candidates.push({
      type:        'lead_surge',
      score:       Math.min(1, 0.5 + ctx.leads.hot * 0.1),
      urgency:     ctx.leads.hot >= 6 ? 'high' : 'medium',
      confidence:  0.85,
      explanation: `${ctx.leads.hot} לידים חמים ממתינים לטיפול`,
      signal_ids:  signalIds.slice(0, 3),
      window_days: 2,
    });
  }

  // ── reputation_recovery ────────────────────────────────────────────────────
  if (ctx.reviews.negative_last7d >= 2 && ctx.reviews.avg_rating !== null && ctx.reviews.avg_rating >= 3.5) {
    candidates.push({
      type:        'reputation_recovery',
      score:       0.6 + ctx.reviews.negative_last7d * 0.05,
      urgency:     ctx.reviews.negative_last7d >= 5 ? 'critical' : 'high',
      confidence:  0.80,
      explanation: `${ctx.reviews.negative_last7d} ביקורות שליליות השבוע — הזדמנות לתגובה מהירה`,
      signal_ids:  signalIds.slice(0, 3),
      window_days: 1,
    });
  }

  // ── competitor_gap ─────────────────────────────────────────────────────────
  const fallingCompetitors = ctx.competitors.filter(c => c.trend_direction === 'falling');
  if (fallingCompetitors.length >= 1) {
    candidates.push({
      type:        'competitor_gap',
      score:       0.55 + fallingCompetitors.length * 0.1,
      urgency:     'medium',
      confidence:  0.65,
      explanation: `${fallingCompetitors.length} מתחרים עם ירידה — חלון הזדמנות לתפיסת נתח שוק`,
      signal_ids:  signalIds.slice(0, 2),
      window_days: 7,
    });
  }

  // ── demand_spike (from forecasts) ──────────────────────────────────────────
  const spikeForecast = ctx.forecasts.find(f => f.demand_delta_pct > 20);
  if (spikeForecast) {
    candidates.push({
      type:        'demand_spike',
      score:       Math.min(1, 0.5 + spikeForecast.demand_delta_pct / 100),
      urgency:     spikeForecast.demand_delta_pct > 40 ? 'high' : 'medium',
      confidence:  spikeForecast.confidence,
      explanation: `ביקוש צפוי גבוה ב-${Math.round(spikeForecast.demand_delta_pct)}% בחלון ${spikeForecast.forecast_window}`,
      signal_ids:  [],
      window_days: spikeForecast.forecast_window === '24h' ? 1 : 7,
    });
  }

  // ── demand_spike (from high-urgency signals) ───────────────────────────────
  const highUrgencyCount = ctx.signals.high_urgency;
  if (highUrgencyCount >= 3) {
    candidates.push({
      type:        'demand_spike',
      score:       Math.min(1, 0.45 + highUrgencyCount * 0.05),
      urgency:     highUrgencyCount >= 7 ? 'critical' : 'high',
      confidence:  0.70,
      explanation: `${highUrgencyCount} אותות דחופים זוהו — עלייה חדה בביקוש הצפויה`,
      signal_ids:  signalIds.slice(0, 5),
      window_days: 3,
    });
  }

  // ── local_event ────────────────────────────────────────────────────────────
  const hasLocalEvent = ctx.active_predictions.some(p => p.impact === 'high');
  if (hasLocalEvent) {
    candidates.push({
      type:        'local_event',
      score:       0.65,
      urgency:     'medium',
      confidence:  0.60,
      explanation: `אירוע מקומי עם פוטנציאל תנועה גבוה`,
      signal_ids:  signalIds.slice(0, 2),
      window_days: 5,
    });
  }

  // ── expansion_signal ───────────────────────────────────────────────────────
  if (ctx.sector_knowledge?.trending_services && (ctx.health_score ?? 0) > 60) {
    candidates.push({
      type:        'expansion_signal',
      score:       0.50,
      urgency:     'low',
      confidence:  0.55,
      explanation: `שירותים מובילים בענף: ${ctx.sector_knowledge.trending_services}`,
      signal_ids:  [],
      window_days: 14,
    });
  }

  // ── pricing_opportunity (health is good, sector is growing) ───────────────
  if ((ctx.health_score ?? 0) > 70 && fallingCompetitors.length >= 1) {
    candidates.push({
      type:        'pricing_opportunity',
      score:       0.48,
      urgency:     'low',
      confidence:  0.50,
      explanation: `בריאות עסקית טובה ומתחרים נחלשים — בדוק תמחור`,
      signal_ids:  [],
      window_days: 14,
    });
  }

  return candidates.filter(c => c.score >= MIN_OPPORTUNITY_SCORE);
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function detectOpportunities(
  ctx: EnrichedContext,
  traceId: string,
): Promise<Opportunity[]> {
  logger.info('Detecting opportunities', { businessId: ctx.business_id });

  const candidates = detectCandidates(ctx);
  if (candidates.length === 0) {
    logger.info('No opportunities detected', { businessId: ctx.business_id });
    return [];
  }

  // Expire stale opportunities from previous runs
  await opportunityRepository.expireStale(ctx.business_id);

  const results: Opportunity[] = [];
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const windowStart = now;
    const windowEnd   = new Date(
      Date.now() + candidate.window_days * 86_400_000,
    ).toISOString();

    const dedup_key = hashOpportunity(ctx.business_id, candidate.type, windowStart);

    const opp: Opportunity = {
      id:                    `opp_${nanoid(12)}`,
      business_id:           ctx.business_id,
      type:                  candidate.type,
      source_signal_ids:     candidate.signal_ids,
      source_event_ids:      [],
      source_forecast_ids:   [],
      opportunity_score:     Math.round(candidate.score * 1000) / 1000,
      urgency:               candidate.urgency,
      confidence:            Math.round(candidate.confidence * 1000) / 1000,
      expected_window_start: windowStart,
      expected_window_end:   windowEnd,
      explanation:           candidate.explanation,
      dedup_key,
      status:                'detected',
      created_at:            now,
      updated_at:            now,
    };

    const { id, is_new } = await opportunityRepository.upsert(opp);
    opp.id = id;
    results.push(opp);

    await bus.emit(bus.makeEvent('opportunity.detected', ctx.business_id, {
      event_id:          `evt_${nanoid(8)}`,
      opportunity_id:    id,
      business_id:       ctx.business_id,
      type:              candidate.type,
      opportunity_score: opp.opportunity_score,
      urgency:           candidate.urgency,
      confidence:        opp.confidence,
      dedup_key,
      is_new,
    }, traceId));

    logger.info('Opportunity upserted', {
      id, type: candidate.type, score: opp.opportunity_score, is_new,
    });
  }

  logger.info('Opportunity detection complete', {
    businessId: ctx.business_id,
    found: results.length,
  });

  return results;
}
