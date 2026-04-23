/**
 * SupplyDemandMismatchDetector — Intelligence Engine
 *
 * Detects gaps between demand indicators (leads, signals, forecasts)
 * and supply capacity signals (low competitor availability, health constraints).
 *
 * Insight types produced: 'supply_demand_mismatch'
 * Category: 'opportunity'
 *
 * High-confidence trigger: hot leads ≥ 4 + demand forecast spike + competitor capacity constraint
 * Medium trigger: hot leads ≥ 3 OR (demand spike + competitor falling)
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('SupplyDemandMismatchDetector');

const ENGINE = 'SupplyDemandMismatchDetector';

export function detectSupplyDemandMismatches(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];
  const signalIds = ctx.recent_signals.slice(0, 5).map(s => s.id);

  // ── Indicator 1: Hot lead surge with demand forecast ──────────────────────
  const spikeForecast = ctx.forecasts.find(f => f.demand_delta_pct > 15);
  const hotLeadSurge  = ctx.leads.hot >= 3;

  if (hotLeadSurge && spikeForecast) {
    const confidence = Math.min(0.90, 0.65 + ctx.leads.hot * 0.05);
    const score      = Math.min(1, 0.55 + spikeForecast.demand_delta_pct / 100);

    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'supply_demand_mismatch',
      category:    'opportunity',
      title:       `ביקוש עולה על ההיצע — ${ctx.leads.hot} לידים חמים + תחזית גידול`,
      summary:     `${ctx.leads.hot} לידים חמים ממתינים לטיפול בזמן שהתחזית מצביעה על עלייה של ${Math.round(spikeForecast.demand_delta_pct)}% בביקוש. חלון הזדמנות לטיפול מהיר לפני שהמתחרים ינצלו את הפער.`,
      supporting_signals:       signalIds,
      confidence,
      urgency:     ctx.leads.hot >= 6 ? 'high' : 'medium',
      business_fit: Math.min(1, 0.6 + ctx.leads.hot * 0.05),
      timeframe:   '24h',
      estimated_impact: spikeForecast.demand_delta_pct > 30 ? 'high' : 'medium',
      recommended_action_types: ['outreach', 'campaign'],
      metadata: {
        hot_leads:          ctx.leads.hot,
        demand_delta_pct:   spikeForecast.demand_delta_pct,
        forecast_window:    spikeForecast.forecast_window,
        forecast_confidence: spikeForecast.confidence,
      },
      dedup_key:   `sdd:${ctx.business_id}:hot_leads_forecast`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 2: High-urgency signals without competitor capacity ─────────
  const competitorsFull = ctx.competitors.filter(
    c => c.trend_direction === 'falling' || c.rating === null,
  );
  const highUrgencySignals = ctx.signals.high_urgency;

  if (highUrgencySignals >= 4 && competitorsFull.length >= 1) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'supply_demand_mismatch',
      category:    'opportunity',
      title:       `פער היצע-ביקוש: ${highUrgencySignals} אותות דחופים, מתחרים נחלשים`,
      summary:     `${highUrgencySignals} אותות עם דחיפות גבוהה זוהו בשוק. ${competitorsFull.length} מתחרים מציגים סימני היחלשות — הביקוש קיים אך ההיצע פנוי. זו הזדמנות לתפוס נתח שוק.`,
      supporting_signals:       signalIds,
      confidence:  0.68,
      urgency:     highUrgencySignals >= 7 ? 'high' : 'medium',
      business_fit: 0.65,
      timeframe:   '7d',
      estimated_impact: 'medium',
      recommended_action_types: ['promotion', 'campaign'],
      metadata: {
        high_urgency_signals: highUrgencySignals,
        weak_competitors:     competitorsFull.length,
      },
      dedup_key:   `sdd:${ctx.business_id}:signals_competitor_gap`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 3: Lead surplus without follow-up capacity ──────────────────
  if (ctx.leads.hot >= 5 && ctx.leads.total >= 15) {
    const conversionLag = ctx.leads.hot / Math.max(1, ctx.leads.total);
    if (conversionLag < 0.4) { // hot leads are a small % — conversion bottleneck
      insights.push({
        id:          `ins_${nanoid(10)}`,
        business_id: ctx.business_id,
        engine:      ENGINE,
        type:        'supply_demand_mismatch',
        category:    'opportunity',
        title:       `צוואר בקבוק המרה: ${ctx.leads.hot} לידים חמים מתוך ${ctx.leads.total} סה"כ`,
        summary:     `יחס המרה נמוך (${Math.round(conversionLag * 100)}%) מעיד על פער תפעולי. לידים קיימים אך תהליך ההמרה אינו מיצוי פוטנציאל מלא.`,
        supporting_signals:       signalIds.slice(0, 2),
        confidence:  0.72,
        urgency:     'medium',
        business_fit: 0.70,
        timeframe:   '7d',
        estimated_impact: 'medium',
        recommended_action_types: ['outreach', 'retention'],
        metadata: {
          hot_leads:      ctx.leads.hot,
          total_leads:    ctx.leads.total,
          conversion_lag: Math.round(conversionLag * 100),
        },
        dedup_key:   `sdd:${ctx.business_id}:conversion_bottleneck`,
        created_at:  new Date().toISOString(),
      });
    }
  }

  logger.debug('SupplyDemandMismatch detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
