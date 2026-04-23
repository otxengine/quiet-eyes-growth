/**
 * PriceVacuumDetector — Intelligence Engine
 *
 * Detects pricing gaps in the competitive landscape:
 * - Premium vacuum: no competitor occupying the premium tier
 * - Budget vacuum: no affordable entry-level option
 * - Mid-market squeeze: price wars leaving the middle open
 *
 * Insight types: 'price_vacuum'
 * Category: 'opportunity' or 'optimization'
 *
 * Works from competitor ratings (proxy for price tier) and health score.
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight, InsightCategory } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('PriceVacuumDetector');

const ENGINE = 'PriceVacuumDetector';

// Rating tiers as price proxies
const PREMIUM_THRESHOLD = 4.5;
const BUDGET_THRESHOLD  = 3.5;

export function detectPriceVacuums(ctx: EnrichedContext): Insight[] {
  const insights: Insight[] = [];

  if (ctx.competitors.length === 0) return insights; // can't analyze without competitor data

  const ratedCompetitors    = ctx.competitors.filter(c => c.rating !== null);
  const premiumCompetitors  = ratedCompetitors.filter(c => (c.rating ?? 0) >= PREMIUM_THRESHOLD);
  const budgetCompetitors   = ratedCompetitors.filter(c => (c.rating ?? 0) < BUDGET_THRESHOLD);
  const midMarketCount      = ratedCompetitors.filter(
    c => (c.rating ?? 0) >= BUDGET_THRESHOLD && (c.rating ?? 0) < PREMIUM_THRESHOLD,
  ).length;

  // ── Indicator 1: Premium vacuum ────────────────────────────────────────────
  if (premiumCompetitors.length === 0 && (ctx.health_score ?? 0) > 60) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'price_vacuum',
      category:    'opportunity' as InsightCategory,
      title:       `ריק פרמיום בשוק — אין מתחרה ב-4.5+ כוכבים`,
      summary:     `אף מתחרה מקומי אינו ממוצב בטייר פרמיום (4.5+ כוכבים). בריאות עסקית של ${ctx.health_score}/100 מאפשרת בידול כלפי מעלה. מיצוב פרמיום יכול להגדיל מחיר ממוצע ב-20-40%.`,
      supporting_signals:       [],
      confidence:  0.75,
      urgency:     'medium',
      business_fit: (ctx.health_score ?? 0) / 100,
      timeframe:   '30d',
      estimated_impact: 'high',
      recommended_action_types: ['pricing', 'content', 'reputation'],
      metadata: {
        rated_competitors:   ratedCompetitors.length,
        premium_competitors: 0,
        health_score:        ctx.health_score,
      },
      dedup_key:   `pv:${ctx.business_id}:premium_vacuum`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 2: Mid-market squeeze (too many mid-tier players) ───────────
  if (midMarketCount >= 3 && premiumCompetitors.length === 0) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'price_vacuum',
      category:    'optimization' as InsightCategory,
      title:       `לחץ במיד-מרקט: ${midMarketCount} מתחרים בתחום זהה`,
      summary:     `${midMarketCount} מתחרים מתחרים באותו פלח מחיר (3.5-4.5 כוכבים). התחרות דוחסת מרווחים. בידול כלפי מעלה (פרמיום) או כלפי מטה (ספציפיות) יצמצם חיכוך.`,
      supporting_signals:       [],
      confidence:  0.68,
      urgency:     'medium',
      business_fit: 0.60,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['pricing', 'campaign', 'competitor_response'],
      metadata: {
        mid_market_count: midMarketCount,
        total_competitors: ctx.competitors.length,
      },
      dedup_key:   `pv:${ctx.business_id}:midmarket_squeeze`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 3: Budget vacuum (no affordable option + demand for it) ─────
  if (budgetCompetitors.length === 0 && ctx.leads.total >= 10 && (ctx.health_score ?? 0) < 55) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'price_vacuum',
      category:    'opportunity' as InsightCategory,
      title:       `ריק תקציבי — ביקוש לאופציה נגישה ללא ספק`,
      summary:     `אף מתחרה אינו מציע שירות ברמת תקציב נגישה. פלח השוק הרגיש-למחיר אינו מקבל מענה. חבילת "ערך" ממוקדת עשויה לפתוח פלח לקוחות חדש.`,
      supporting_signals:       [],
      confidence:  0.58,
      urgency:     'low',
      business_fit: 0.55,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['pricing', 'promotion'],
      metadata: {
        budget_competitors: 0,
        total_leads:        ctx.leads.total,
        health_score:       ctx.health_score,
      },
      dedup_key:   `pv:${ctx.business_id}:budget_vacuum`,
      created_at:  new Date().toISOString(),
    });
  }

  // ── Indicator 4: Rising competitor with price advantage — react ───────────
  const risingHighRated = ctx.competitors.filter(
    c => c.trend_direction === 'rising' && (c.rating ?? 0) >= 4.2,
  );
  if (risingHighRated.length >= 2) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'price_vacuum',
      category:    'threat' as InsightCategory,
      title:       `לחץ תחרותי: ${risingHighRated.length} מתחרים חזקים בעלייה`,
      summary:     `${risingHighRated.length} מתחרים בעלי דירוג גבוה מציגים מגמת עלייה. סכנת ספיגת נתח שוק. בחינת מיצוב מחיר ושיפור ערך מוסף הם עדיפות.`,
      supporting_signals:       [],
      confidence:  0.78,
      urgency:     'high',
      business_fit: 0.70,
      timeframe:   '7d',
      estimated_impact: 'high',
      recommended_action_types: ['competitor_response', 'pricing', 'promotion'],
      metadata: {
        rising_competitors: risingHighRated.map(c => c.name),
      },
      dedup_key:   `pv:${ctx.business_id}:rising_competitors`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('PriceVacuum detection complete', {
    businessId: ctx.business_id, found: insights.length,
  });

  return insights;
}
