/**
 * TimingArbitrageEngine — Intelligence Engine
 *
 * Identifies time-based demand gaps where high demand exists in windows
 * competitors don't serve: off-peak competitor absence, promotional timing gaps,
 * and event-driven windows.
 *
 * Insight types: 'timing_arbitrage'
 * Category: 'opportunity'
 *
 * Time windows analyzed:
 * - Off-peak vs competitor peak conflict
 * - Pre-event / pre-holiday capture window
 * - Low-competition time slots (early morning, late evening, weekends)
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('TimingArbitrageEngine');

const ENGINE = 'TimingArbitrageEngine';

/** Israeli market timing archetypes */
const PEAK_WINDOWS = {
  morning:   { hours: [7, 8, 9, 10],   label: 'בוקר מוקדם (7-10)',     demand_factor: 0.85 },
  lunch:     { hours: [12, 13, 14],    label: 'שעות צהריים (12-14)',    demand_factor: 0.90 },
  afternoon: { hours: [15, 16, 17, 18], label: 'אחה"צ (15-18)',          demand_factor: 0.95 },
  evening:   { hours: [19, 20, 21],    label: 'ערב (19-21)',             demand_factor: 0.75 },
  weekend:   { days: [5, 6],           label: 'שישי-שבת',                demand_factor: 0.80 },
};

export function detectTimingArbitrage(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];
  const now      = new Date();
  const hour     = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun ... 6=Sat
  const signalIds = ctx.recent_signals.slice(0, 3).map(s => s.id);

  // ── Indicator 1: High-urgency signals arriving in a specific time window ──
  // If we have high urgency signals NOW, this window has active demand
  if (ctx.signals.high_urgency >= 3) {
    const currentWindow = Object.entries(PEAK_WINDOWS).find(([key, w]) => {
      if ('hours' in w) return w.hours.includes(hour);
      if ('days' in w) return w.days.includes(dayOfWeek);
      return false;
    });

    if (currentWindow) {
      const [windowKey, windowData] = currentWindow;
      const competitorAvailable = ctx.competitors.filter(c =>
        c.trend_direction !== 'falling',
      ).length;

      const arbitrageGap = ctx.competitors.length > 0
        ? Math.max(0, 1 - competitorAvailable / ctx.competitors.length)
        : 0.5;

      if (arbitrageGap > 0.3) {
        insights.push({
          id:          `ins_${nanoid(10)}`,
          business_id: ctx.business_id,
          engine:      ENGINE,
          type:        'timing_arbitrage',
          category:    'opportunity',
          title:       `ביקוש פעיל ב${windowData.label} — חלון תחרותי פתוח`,
          summary:     `${ctx.signals.high_urgency} אותות דחופים מגיעים בשעה זו (${windowData.label}). ${Math.round(arbitrageGap * 100)}% מהמתחרים אינם זמינים. זו הזדמנות תזמון — הגב עכשיו.`,
          supporting_signals:       signalIds,
          confidence:  Math.min(0.85, 0.60 + ctx.signals.high_urgency * 0.04),
          urgency:     ctx.signals.high_urgency >= 5 ? 'high' : 'medium',
          business_fit: 0.75,
          timeframe:   '24h',
          estimated_impact: 'high',
          recommended_action_types: ['outreach', 'promotion', 'campaign'],
          metadata: {
            window:              windowKey,
            window_label:        windowData.label,
            hour,
            high_urgency_signals: ctx.signals.high_urgency,
            arbitrage_gap_pct:   Math.round(arbitrageGap * 100),
          },
          dedup_key:   `ta:${ctx.business_id}:active_window_${windowKey}`,
          created_at:  new Date().toISOString(),
        });
      }
    }
  }

  // ── Indicator 2: Pre-event timing capture ─────────────────────────────────
  const highImpactPredictions = ctx.active_predictions.filter(p => p.impact === 'high');
  if (highImpactPredictions.length > 0) {
    const pred = highImpactPredictions[0];
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'timing_arbitrage',
      category:    'opportunity',
      title:       `חלון לפני אירוע: ${pred.title?.slice(0, 40) ?? 'אירוע בעל השפעה גבוהה'}`,
      summary:     `אירוע בעל השפעה גבוהה צפוי (${pred.timeframe ?? 'בקרוב'}). עסקים שמקדימים בשיווק לפני האירוע מקבלים 60% יותר המרות מאלו שמגיבים אחרי.`,
      supporting_signals:       signalIds,
      confidence:  pred.confidence ?? 0.65,
      urgency:     'high',
      business_fit: 0.72,
      timeframe:   pred.timeframe ?? '7d',
      estimated_impact: 'high',
      recommended_action_types: ['campaign', 'promotion', 'content'],
      metadata: {
        event_title:      pred.title,
        event_confidence: pred.confidence,
        event_timeframe:  pred.timeframe,
      },
      dedup_key:   `ta:${ctx.business_id}:pre_event_${pred.title?.slice(0, 20) ?? 'event'}`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 3: Weekend timing arbitrage (if sector allows) ──────────────
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday in Israel
  if (!isWeekend && ctx.leads.hot >= 2) {
    // Approaching weekend with active hot leads → capture before Shabbat
    const daysToWeekend = (5 - dayOfWeek + 7) % 7;
    if (daysToWeekend <= 2) {
      insights.push({
        id:          `ins_${nanoid(10)}`,
        business_id: ctx.business_id,
        engine:      ENGINE,
        type:        'timing_arbitrage',
        category:    'opportunity',
        title:       `חלון לפני סוף שבוע — ${ctx.leads.hot} לידים חמים ממתינים`,
        summary:     `${daysToWeekend === 1 ? 'מחר' : 'בעוד יומיים'} מגיע סוף השבוע. ${ctx.leads.hot} לידים חמים שלא טופלו עד שישי עלולים לקרר. פנה עכשיו לפני חלון ההפסד.`,
        supporting_signals:       [],
        confidence:  0.78,
        urgency:     daysToWeekend === 1 ? 'high' : 'medium',
        business_fit: 0.80,
        timeframe:   '24h',
        estimated_impact: 'medium',
        recommended_action_types: ['outreach'],
        metadata: {
          days_to_weekend: daysToWeekend,
          hot_leads:       ctx.leads.hot,
          day_of_week:     dayOfWeek,
        },
        dedup_key:   `ta:${ctx.business_id}:pre_weekend`,
        created_at:  new Date().toISOString(),
      });
    }
  }

  // ── Indicator 4: Demand forecast window approaching ───────────────────────
  const shortTermForecast = ctx.forecasts.find(
    f => f.forecast_window === '24h' && f.demand_delta_pct > 10,
  );
  if (shortTermForecast) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'timing_arbitrage',
      category:    'opportunity',
      title:       `תחזית ביקוש ל-24 שעות: +${Math.round(shortTermForecast.demand_delta_pct)}%`,
      summary:     `מודל תחזית מזהה עלייה של ${Math.round(shortTermForecast.demand_delta_pct)}% בביקוש ב-24 שעות הקרובות. הכנה מוקדמת (מלאי, זמינות, מבצע) תמנע אובדן הכנסה.`,
      supporting_signals:       [],
      confidence:  shortTermForecast.confidence,
      urgency:     'high',
      business_fit: 0.85,
      timeframe:   '24h',
      estimated_impact: shortTermForecast.demand_delta_pct > 25 ? 'high' : 'medium',
      recommended_action_types: ['promotion', 'campaign', 'outreach'],
      metadata: {
        demand_delta_pct:   shortTermForecast.demand_delta_pct,
        forecast_confidence: shortTermForecast.confidence,
      },
      dedup_key:   `ta:${ctx.business_id}:24h_forecast`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('TimingArbitrage detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
