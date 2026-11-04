/**
 * DemandForecastingService — Prediction Layer
 *
 * Replaces the stub runPredictions LLM route with a fully data-driven
 * demand forecasting engine. No LLM required — all scores are formula-based,
 * derived from classified signals, lead trends, competitor dynamics, and
 * Israeli seasonal patterns.
 *
 * Pipeline position: market_intelligence → [DemandForecastingService] → fuse
 *
 * Forecast windows: 24h, 7d, 30d
 *
 * Scoring model:
 *   signal_velocity    (30%) — new signals this window vs previous window
 *   lead_trend         (25%) — hot-lead conversion trend
 *   competitor_pressure (20%) — rising competitor pressure
 *   review_sentiment   (15%) — recent review trajectory
 *   seasonal_factor    (10%) — Israeli calendar seasonality
 *
 * Rules:
 *  - Pure data derivation — no decisions, no recommendations
 *  - Emits forecast.updated once per run
 *  - Persists to Prisma prediction table (compatible with legacy UI)
 *  - Returns DemandForecast[] for injection into context.forecasts
 */

import { nanoid }            from 'nanoid';
import { prisma }            from '../../db';
import type { EnrichedContext, DemandForecast, ForecastFactor } from '../../models';
import { bus }               from '../../events/EventBus';
import { createLogger }      from '../../infra/logger';

const logger = createLogger('DemandForecastingService');

// ─── Israeli seasonal calendar ────────────────────────────────────────────────

interface SeasonalWindow {
  label:     string;       // Hebrew label
  months:    number[];     // 1-based month numbers
  weeks?:    number[];     // 1-based ISO week numbers
  factor:    number;       // demand multiplier (1.0 = neutral)
  sector:    string[];     // applicable sectors ('*' = all)
}

const SEASONAL_WINDOWS: SeasonalWindow[] = [
  { label: 'חנוכה',       months: [12],      factor: 1.35, sector: ['food', 'retail', 'services'] },
  { label: 'ראש השנה',    months: [9],       factor: 1.40, sector: ['food', 'services', '*'] },
  { label: 'פסח',         months: [3, 4],    factor: 1.30, sector: ['food', 'retail', 'beauty'] },
  { label: 'קיץ',         months: [7, 8],    factor: 1.25, sector: ['fitness', 'beauty', 'food'] },
  { label: 'בחזרה לעבודה', months: [9, 10],  factor: 1.20, sector: ['services', 'fitness'] },
  { label: 'יום העצמאות', months: [4, 5],   factor: 1.30, sector: ['food', '*'] },
  { label: 'חורף',        months: [1, 2],    factor: 0.85, sector: ['*'] },
];

function getSeasonalFactor(category: string | null): number {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const cat   = (category ?? '').toLowerCase();

  let factor = 1.0;

  for (const win of SEASONAL_WINDOWS) {
    if (!win.months.includes(month)) continue;

    const matchesSector =
      win.sector.includes('*') ||
      win.sector.some(s => cat.includes(s));

    if (matchesSector) {
      factor = Math.max(factor, win.factor); // take the strongest seasonal signal
    }
  }

  return factor;
}

// ─── Velocity helpers ─────────────────────────────────────────────────────────

/** Signal count in a time window, from context items */
function signalCountInWindow(signals: any[], hoursAgo: number): number {
  const cutoff = Date.now() - hoursAgo * 3_600_000;
  return signals.filter(s => {
    const t = new Date(s.classified_at ?? s.created_at ?? 0).getTime();
    return t >= cutoff;
  }).length;
}

/**
 * Signal velocity ratio: recent count vs previous count.
 * Returns value in [-1, +1]: positive = growing demand.
 */
function signalVelocityDelta(signals: any[], windowHours: number): number {
  const recent   = signalCountInWindow(signals, windowHours);
  const previous = signalCountInWindow(signals, windowHours * 2) - recent;

  if (previous === 0) return recent > 0 ? 0.5 : 0;

  const ratio = (recent - previous) / previous;
  return Math.max(-1, Math.min(1, ratio)); // clamp to [-1, 1]
}

/** Lead trend: change in hot leads as a fraction of total */
function leadTrendDelta(leads: { total: number; hot: number; warm: number; avg_score: number }): number {
  const hotRate = leads.total > 0 ? leads.hot / leads.total : 0;
  const avgNorm = leads.avg_score / 100;

  // Combine hot-lead rate and average quality
  const rawDelta = hotRate * 0.6 + avgNorm * 0.4 - 0.5; // center at 0
  return Math.max(-1, Math.min(1, rawDelta * 2));
}

/** Competitor pressure: proportion of rising competitors */
function competitorPressureDelta(competitors: any[]): number {
  if (competitors.length === 0) return 0;

  const rising  = competitors.filter(c => c.trend_direction === 'rising').length;
  const falling = competitors.filter(c => c.trend_direction === 'falling').length;

  const pressureRatio = (rising - falling) / competitors.length;
  // Rising competitors = negative demand effect for us
  return -pressureRatio;
}

/** Review sentiment delta: ratio of recent positive to negative */
function reviewSentimentDelta(reviews: {
  total: number; avg_rating: number; negative_last7d: number; pending_response: number;
}): number {
  if (reviews.total === 0) return 0;

  // Normalize avg_rating to [-1, +1] (4.5+ = positive, below 3.5 = negative)
  const ratingDelta = (reviews.avg_rating - 4.0) / 2.0;

  // Negative review velocity penalty
  const negRate = reviews.negative_last7d / Math.max(1, reviews.total);
  const negPenalty = negRate * 2;

  return Math.max(-1, Math.min(1, ratingDelta - negPenalty));
}

// ─── Forecast computation ─────────────────────────────────────────────────────

interface ForecastInputs {
  signalDelta:      number;   // [-1, +1]
  leadDelta:        number;   // [-1, +1]
  competitorDelta:  number;   // [-1, +1]
  reviewDelta:      number;   // [-1, +1]
  seasonalFactor:   number;   // [0.5, 2.0]
}

function computeForecastDeltaPct(inputs: ForecastInputs): number {
  // Weighted sum of normalised deltas
  const rawDelta =
    inputs.signalDelta    * 0.30 +
    inputs.leadDelta      * 0.25 +
    inputs.competitorDelta * 0.20 +
    inputs.reviewDelta    * 0.15;

  // Season multiplier amplifies or dampens the raw delta
  const seasonAdjusted = rawDelta * inputs.seasonalFactor;

  // Scale to percentage change: ±50% max
  return Math.round(seasonAdjusted * 50 * 10) / 10;
}

function computeConfidence(inputs: ForecastInputs, signalCount: number): number {
  // Confidence grows with more signals + higher absolute delta agreement
  const dataRichness   = Math.min(1, signalCount / 20);
  const deltaAgreement = Math.abs(inputs.signalDelta + inputs.leadDelta) / 2;

  const confidence = dataRichness * 0.6 + deltaAgreement * 0.4;
  return Math.round(Math.min(0.95, Math.max(0.30, confidence)) * 1000) / 1000;
}

function buildFactors(inputs: ForecastInputs): ForecastFactor[] {
  return [
    {
      name:        'signal_velocity',
      weight:      0.30,
      description: `Signal velocity delta: ${(inputs.signalDelta * 100).toFixed(0)}%`,
    },
    {
      name:        'lead_trend',
      weight:      0.25,
      description: `Lead quality trend: ${(inputs.leadDelta * 100).toFixed(0)}%`,
    },
    {
      name:        'competitor_dynamics',
      weight:      0.20,
      description: `Competitor pressure delta: ${(inputs.competitorDelta * 100).toFixed(0)}%`,
    },
    {
      name:        'review_sentiment',
      weight:      0.15,
      description: `Review sentiment delta: ${(inputs.reviewDelta * 100).toFixed(0)}%`,
    },
    {
      name:        'seasonal_factor',
      weight:      0.10,
      description: `Seasonal multiplier: ×${inputs.seasonalFactor.toFixed(2)}`,
    },
  ];
}

// ─── Persistence helper ────────────────────────────────────────────────────────

/**
 * Save forecast to Prisma prediction table (compatible with legacy UI).
 * Uses ON CONFLICT DO NOTHING for idempotency within same day.
 */
async function persistForecast(
  businessId: string,
  window:     string,
  deltaP:     number,
  confidence: number,
  factors:    ForecastFactor[],
): Promise<void> {
  const impactLevel = Math.abs(deltaP) >= 30 ? 'high'
                    : Math.abs(deltaP) >= 15 ? 'medium'
                    : 'low';

  const direction = deltaP >= 10  ? 'עלייה צפויה בביקוש'
                  : deltaP <= -10 ? 'ירידה צפויה בביקוש'
                  : 'ביקוש יציב צפוי';

  const factorText = factors.map(f => f.description).join('; ');

  try {
    // Check if a forecast for this window already exists today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.prediction.findFirst({
      where: {
        linked_business: businessId,
        prediction_type: `demand_forecast_${window}`,
        predicted_at:    { gte: today.toISOString() },
      },
    });

    if (existing) return; // idempotent — skip if already forecast today

    await prisma.prediction.create({
      data: {
        title:               `חיזוי ביקוש — ${window} | ${direction}`,
        summary:             `שינוי צפוי: ${deltaP > 0 ? '+' : ''}${deltaP}% (ביטחון: ${(confidence * 100).toFixed(0)}%)`,
        prediction_type:     `demand_forecast_${window}`,
        confidence:          Math.round(confidence * 100),
        timeframe:           window,
        impact_level:        impactLevel,
        recommended_actions: factorText,
        is_read:             false,
        status:              'active',
        predicted_at:        new Date().toISOString(),
        linked_business:     businessId,
      },
    });
  } catch (err: any) {
    logger.error('Failed to persist forecast', { businessId, window, error: err.message });
  }
}

// ─── Main service ─────────────────────────────────────────────────────────────

export interface ForecastResult {
  forecasts:   DemandForecast[];
  duration_ms: number;
}

/**
 * computeForecasts — generates data-driven demand forecasts for all windows.
 *
 * Called by MasterOrchestrator in the `predict` stage.
 * Injects results into context.forecasts.
 */
export async function computeForecasts(
  ctx:     EnrichedContext,
  traceId: string,
): Promise<ForecastResult> {
  const t0 = Date.now();
  logger.info('DemandForecastingService started', { businessId: ctx.business_id });

  const signals    = ctx.signals.items ?? [];
  const signalCount = ctx.signals.total;

  // ── Compute shared inputs ──────────────────────────────────────────────────
  const seasonalFactor = getSeasonalFactor(ctx.profile.category);

  const inputs7d: ForecastInputs = {
    signalDelta:      signalVelocityDelta(signals, 168),   // 7d vs 14d
    leadDelta:        leadTrendDelta(ctx.leads),
    competitorDelta:  competitorPressureDelta(ctx.competitors),
    reviewDelta:      reviewSentimentDelta(ctx.reviews),
    seasonalFactor,
  };

  const inputs24h: ForecastInputs = {
    signalDelta:      signalVelocityDelta(signals, 24),    // 24h vs 48h
    leadDelta:        leadTrendDelta(ctx.leads),
    competitorDelta:  competitorPressureDelta(ctx.competitors),
    reviewDelta:      reviewSentimentDelta(ctx.reviews),
    seasonalFactor,
  };

  const inputs30d: ForecastInputs = {
    // 30-day uses 7-day velocity as the best proxy
    signalDelta:      inputs7d.signalDelta * 0.7,          // dampened — longer horizon = less certainty
    leadDelta:        inputs7d.leadDelta   * 0.8,
    competitorDelta:  inputs7d.competitorDelta,
    reviewDelta:      inputs7d.reviewDelta * 0.9,
    seasonalFactor,
  };

  // ── Build forecasts for each window ───────────────────────────────────────
  const windows: Array<{ key: string; inputs: ForecastInputs }> = [
    { key: '24h', inputs: inputs24h },
    { key: '7d',  inputs: inputs7d  },
    { key: '30d', inputs: inputs30d },
  ];

  const forecasts: DemandForecast[] = [];

  for (const { key, inputs } of windows) {
    const deltaP     = computeForecastDeltaPct(inputs);
    const confidence = computeConfidence(inputs, signalCount);
    const factors    = buildFactors(inputs);

    const forecast: DemandForecast = {
      id:                    `fc_${nanoid(8)}`,
      business_id:           ctx.business_id,
      forecast_window:       key,
      expected_demand_score: Math.round(Math.min(100, Math.max(0, 50 + deltaP))),
      demand_delta_pct:      deltaP,
      confidence,
      factors,
      created_at:            new Date().toISOString(),
    };

    forecasts.push(forecast);

    // Persist to legacy prediction table (non-blocking)
    persistForecast(ctx.business_id, key, deltaP, confidence, factors).catch(() => {});
  }

  // ── Inject into context ───────────────────────────────────────────────────
  ctx.forecasts = forecasts;

  // ── Emit forecast.updated event ───────────────────────────────────────────
  const lead7d = forecasts.find(f => f.forecast_window === '7d');
  if (lead7d) {
    await bus.emit(bus.makeEvent('forecast.updated', ctx.business_id, {
      business_id:      ctx.business_id,
      forecast_window:  '7d',
      demand_delta_pct: lead7d.demand_delta_pct,
      confidence:       lead7d.confidence,
      expected_demand:  lead7d.expected_demand_score,
      seasonal_factor:  seasonalFactor,
      forecasts_count:  forecasts.length,
    }, traceId));
  }

  // Emit demand.spike.detected if 7d delta > 20%
  if (lead7d && lead7d.demand_delta_pct >= 20) {
    await bus.emit(bus.makeEvent('demand.spike.detected', ctx.business_id, {
      business_id:     ctx.business_id,
      demand_delta_pct: lead7d.demand_delta_pct,
      window:          '7d',
      confidence:      lead7d.confidence,
    }, traceId));
  }

  const duration_ms = Date.now() - t0;

  logger.info('DemandForecastingService complete', {
    businessId: ctx.business_id,
    forecasts:  forecasts.length,
    delta7d:    lead7d?.demand_delta_pct,
    duration_ms,
  });

  return { forecasts, duration_ms };
}
