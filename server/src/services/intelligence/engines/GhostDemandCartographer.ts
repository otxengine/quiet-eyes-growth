/**
 * GhostDemandCartographer — Intelligence Engine
 *
 * Maps invisible / latent demand — demand that exists but isn't actively expressed
 * in current signals. Identifies seasonal patterns, adjacent-market demand,
 * and under-served customer segments.
 *
 * Insight types: 'ghost_demand'
 * Category: 'opportunity'
 *
 * Triggers:
 * - Calendar-based seasonality (Jewish holidays, summer, school year)
 * - Adjacent sector demand that would convert
 * - Low-visibility demographic opportunity
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('GhostDemandCartographer');

const ENGINE = 'GhostDemandCartographer';

// Israeli market seasonal windows (month → opportunities)
const SEASONAL_WINDOWS: Record<number, { label: string; impact: 'medium' | 'high'; days: number }> = {
  0:  { label: 'חנוכה — עונת מתנות ואירועים',         impact: 'medium', days: 30 }, // Jan (Hanukkah Dec-Jan)
  2:  { label: 'פורים — עונת תחפושות ואירועים',        impact: 'high',   days: 20 }, // March
  3:  { label: 'פסח — עונת קפיצת ביקוש',               impact: 'high',   days: 40 }, // April
  6:  { label: 'קיץ — עונת תיירות ופנאי',               impact: 'high',   days: 90 }, // July
  7:  { label: 'קיץ — שיא עונת פנאי',                   impact: 'high',   days: 60 }, // August
  8:  { label: 'חזרה לבית הספר — עונת שירותי ילדים',    impact: 'medium', days: 30 }, // September
  9:  { label: 'חגי תשרי — ראש השנה, סוכות, חגיגות',   impact: 'high',   days: 30 }, // October
  11: { label: 'חנוכה + סוף שנה — עונת מתנות',         impact: 'high',   days: 25 }, // December
};

export function detectGhostDemand(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];
  const now      = new Date();
  const month    = now.getMonth();
  const signalIds = ctx.recent_signals.slice(0, 3).map(s => s.id);

  // ── Indicator 1: Seasonal window approaching ───────────────────────────────
  // Check current month and next month
  for (const checkMonth of [month, (month + 1) % 12]) {
    const window = SEASONAL_WINDOWS[checkMonth];
    if (!window) continue;

    // Only fire if we have reasonable health and sector knowledge
    if ((ctx.health_score ?? 0) > 35 || ctx.sector_knowledge) {
      const isUpcoming = checkMonth === (month + 1) % 12;
      const confidence = isUpcoming ? 0.72 : 0.65;

      insights.push({
        id:          `ins_${nanoid(10)}`,
        business_id: ctx.business_id,
        engine:      ENGINE,
        type:        'ghost_demand',
        category:    'opportunity',
        title:       `ביקוש עונתי צפוי: ${window.label}`,
        summary:     `${isUpcoming ? 'בחודש הקרוב' : 'כעת'}: ${window.label}. ביקוש מוסווה מתחיל להתפתח — רוב העסקים לא מגיבים בזמן. התחלה מוקדמת מובילה לשיעור המרה גבוה ב-40%.`,
        supporting_signals:       signalIds,
        confidence,
        urgency:     isUpcoming ? 'medium' : window.impact === 'high' ? 'high' : 'medium',
        business_fit: 0.70,
        timeframe:   isUpcoming ? '7d' : '24h',
        estimated_impact: window.impact,
        recommended_action_types: ['campaign', 'content', 'promotion'],
        metadata: {
          season_label: window.label,
          window_days:  window.days,
          is_upcoming:  isUpcoming,
          month:        checkMonth,
        },
        dedup_key:   `gd:${ctx.business_id}:season_${checkMonth}`,
        created_at:  new Date().toISOString(),
      });

      break; // Only one seasonal insight at a time
    }
  }

  // ── Indicator 2: Adjacent market demand (cross-sector spill) ──────────────
  // If sector has trending services that match signals from other sectors
  const sectorKeyword = ctx.sector_knowledge?.trending_services?.toLowerCase() ?? '';
  const crossSectorSignals = ctx.recent_signals.filter(s =>
    s.category && s.category !== ctx.profile?.category &&
    (sectorKeyword && s.summary.toLowerCase().includes(sectorKeyword.split(' ')[0])),
  );

  if (crossSectorSignals.length >= 2) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'ghost_demand',
      category:    'opportunity',
      title:       `ביקוש סמוי מסקטור סמוך (${crossSectorSignals.length} אותות)`,
      summary:     `${crossSectorSignals.length} אותות מסקטורים שכנים מציינים ביקוש שאינו מטופל על ידי ספק מקומי. הביקוש קיים אך עדיין לא מופנה לעסקים מתחומך.`,
      supporting_signals:       crossSectorSignals.slice(0, 3).map(s => s.id),
      confidence:  0.60,
      urgency:     'low',
      business_fit: 0.55,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['expansion', 'content'],
      metadata: {
        signal_count:   crossSectorSignals.length,
        sector_keyword: sectorKeyword.slice(0, 30),
      },
      dedup_key:   `gd:${ctx.business_id}:cross_sector`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 3: Low-visibility warm leads that haven't converted ─────────
  if (ctx.leads.warm >= 5 && ctx.leads.hot < 2) {
    // Many warm leads but very few hot → latent conversion pool
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'ghost_demand',
      category:    'opportunity',
      title:       `${ctx.leads.warm} לידים פושרים עם פוטנציאל נסתר`,
      summary:     `${ctx.leads.warm} לידים פושרים לא הוסבו ללידים חמים. ביקוש קיים אך לא מעורר — חיזוק ממוקד יכול לשחרר ביקוש רדום.`,
      supporting_signals:       [],
      confidence:  0.67,
      urgency:     'medium',
      business_fit: 0.75,
      timeframe:   '7d',
      estimated_impact: 'medium',
      recommended_action_types: ['outreach', 'retention'],
      metadata: {
        warm_leads:  ctx.leads.warm,
        hot_leads:   ctx.leads.hot,
        total_leads: ctx.leads.total,
      },
      dedup_key:   `gd:${ctx.business_id}:warm_leads_latent`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('GhostDemand detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
