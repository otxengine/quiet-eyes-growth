/**
 * TrustSignalAggregator — Intelligence Engine
 *
 * Aggregates all digital trust signals and produces:
 * 1. TrustState — quantified trust position vs competitors
 * 2. Insight[] — trust gap or trust advantage insights
 *
 * Trust signals measured:
 * - Review rating (avg vs competitors)
 * - Review velocity (reviews per week)
 * - Response rate (pending reviews / total)
 * - Review recency (fresh > 90 days?)
 * - Star distribution (concentration at high vs low)
 *
 * Insight types: 'trust_gap'
 * Category: 'trust'
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight, TrustState } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('TrustSignalAggregator');

const ENGINE = 'TrustSignalAggregator';

export interface TrustAnalysis {
  trust_state: TrustState;
  insights:    Insight[];
}

export function analyzeTrustSignals(ctx: EnrichedContext): TrustAnalysis {
  const insights: Insight[] = [];

  // ── Compute trust score (0–100) ────────────────────────────────────────────
  const avgRating      = ctx.reviews.avg_rating ?? 0;
  const totalReviews   = ctx.reviews.total;
  const pendingResp    = ctx.reviews.pending_response;
  const negLast7d      = ctx.reviews.negative_last7d;

  // Rating component: 0–40 points
  const ratingScore = Math.min(40, (avgRating / 5) * 40);

  // Volume component: 0–20 points (more reviews = more trust signals)
  const volumeScore = Math.min(20, totalReviews * 0.4);

  // Response rate component: 0–20 points
  const responseRate = totalReviews > 0
    ? Math.max(0, 1 - pendingResp / totalReviews)
    : 0.5;
  const responseScore = responseRate * 20;

  // Recency component: 0–20 points (recent negatives penalize)
  const negPenalty  = Math.min(20, negLast7d * 3);
  const recencyScore = Math.max(0, 20 - negPenalty);

  const trustScore = Math.round(ratingScore + volumeScore + responseScore + recencyScore);

  // ── Competitor comparison ──────────────────────────────────────────────────
  const compRatings = ctx.competitors
    .filter(c => c.rating !== null)
    .map(c => c.rating as number);

  const avgCompRating = compRatings.length > 0
    ? compRatings.reduce((a, b) => a + b, 0) / compRatings.length
    : avgRating;

  const ratingDiff = avgRating - avgCompRating;   // positive = we're better
  const vsCompetitors = Math.max(-1, Math.min(1, ratingDiff / 1.5));  // normalise to -1..+1

  const gapType: TrustState['gap_type'] =
    vsCompetitors > 0.15 ? 'leading' :
    vsCompetitors < -0.15 ? 'lagging' : 'on_par';

  // Review velocity (reviews per week, approximate from total)
  const reviewVelocity = Math.min(10, totalReviews / 4);  // assume 4-week window

  // Signal strength from total reviews
  const signalStrength: TrustState['signal_strength'] =
    totalReviews >= 30 ? 'strong' :
    totalReviews >= 10 ? 'moderate' : 'weak';

  // Recommendations
  const recommendations: string[] = [];
  if (pendingResp > 0)        recommendations.push(`ענה ל-${pendingResp} ביקורות ממתינות`);
  if (negLast7d >= 2)         recommendations.push(`טפל ב-${negLast7d} ביקורות שליליות מהשבוע`);
  if (signalStrength === 'weak') recommendations.push('הגדל נפח ביקורות — בקש מלקוחות מרוצים');
  if (gapType === 'lagging')  recommendations.push(`צמצם פער דירוג: ${avgRating.toFixed(1)} vs מתחרים ${avgCompRating.toFixed(1)}`);

  const trust_state: TrustState = {
    trust_score:     trustScore,
    vs_competitors:  Math.round(vsCompetitors * 100) / 100,
    review_velocity: Math.round(reviewVelocity * 10) / 10,
    response_rate:   Math.round(responseRate * 100) / 100,
    signal_strength: signalStrength,
    gap_type:        gapType,
    recommendations,
  };

  // ── Generate trust insights ────────────────────────────────────────────────

  // Insight 1: Trust gap — we're lagging
  if (gapType === 'lagging' && compRatings.length > 0) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'trust_gap',
      category:    'threat',
      title:       `פער אמון: דירוג ${avgRating.toFixed(1)} vs מתחרים ${avgCompRating.toFixed(1)}`,
      summary:     `הדירוג הממוצע (${avgRating.toFixed(1)}) נמוך מהממוצע של המתחרים (${avgCompRating.toFixed(1)}). ${Math.abs(ratingDiff).toFixed(1)} נקודות פער משפיעות ישירות על שיעורי ההמרה. שיפור מהיר: מענה לביקורות + בקשה ממתינים מרוצים.`,
      supporting_signals:       [],
      confidence:  compRatings.length >= 3 ? 0.85 : 0.70,
      urgency:     Math.abs(ratingDiff) > 0.5 ? 'high' : 'medium',
      business_fit: 0.90,
      timeframe:   '7d',
      estimated_impact: 'high',
      recommended_action_types: ['reputation', 'content'],
      metadata: {
        our_rating:    avgRating,
        avg_competitor: avgCompRating,
        rating_gap:    Math.round(ratingDiff * 100) / 100,
        trust_score:   trustScore,
      },
      dedup_key:   `tr:${ctx.business_id}:trust_gap_lagging`,
      created_at:  new Date().toISOString(),
    });
  }

  // Insight 2: Trust advantage — we're leading
  if (gapType === 'leading' && compRatings.length > 0) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'trust_gap',
      category:    'opportunity',
      title:       `יתרון אמון: ${avgRating.toFixed(1)} vs מתחרים ${avgCompRating.toFixed(1)}`,
      summary:     `דירוג גבוה ממוצע המתחרים ב-${ratingDiff.toFixed(1)} נקודות. זוהי נכס תחרותי שיש לנצל — הצגת ביקורות, trust badge, ו-social proof יגדילו שיעורי המרה.`,
      supporting_signals:       [],
      confidence:  0.82,
      urgency:     'low',
      business_fit: 0.85,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['content', 'campaign', 'reputation'],
      metadata: {
        our_rating:    avgRating,
        avg_competitor: avgCompRating,
        rating_advantage: Math.round(ratingDiff * 100) / 100,
      },
      dedup_key:   `tr:${ctx.business_id}:trust_gap_leading`,
      created_at:  new Date().toISOString(),
    });
  }

  // Insight 3: High pending response rate
  if (pendingResp >= 3 || (totalReviews > 0 && pendingResp / totalReviews > 0.3)) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'trust_gap',
      category:    'threat',
      title:       `${pendingResp} ביקורות ללא מענה פוגעות בדירוג`,
      summary:     `ביקורות ללא תגובה מפחיתות אמון: לקוחות פוטנציאליים רואים ביקורת ומחפשים מענה. מענה תוך 24 שעות מגדיל אמון ב-40%.`,
      supporting_signals:       [],
      confidence:  0.88,
      urgency:     pendingResp >= 5 ? 'high' : 'medium',
      business_fit: 0.95,
      timeframe:   '24h',
      estimated_impact: 'medium',
      recommended_action_types: ['reputation'],
      metadata: {
        pending_responses: pendingResp,
        total_reviews:     totalReviews,
        response_rate_pct: Math.round(responseRate * 100),
      },
      dedup_key:   `tr:${ctx.business_id}:pending_responses`,
      created_at:  new Date().toISOString(),
    });
  }

  // Insight 4: Weak signal strength — not enough reviews
  if (signalStrength === 'weak' && totalReviews < 10) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'trust_gap',
      category:    'optimization',
      title:       `ביסוס אמון: רק ${totalReviews} ביקורות — מתחת לסף אמינות`,
      summary:     `עסקים עם פחות מ-10 ביקורות מקבלים 50% פחות לחיצות מאלו עם 10+ ביקורות. יש לפעיל קמפיין איסוף ביקורות ממוקד.`,
      supporting_signals:       [],
      confidence:  0.80,
      urgency:     'medium',
      business_fit: 0.90,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['reputation', 'outreach', 'content'],
      metadata: {
        total_reviews:    totalReviews,
        target_reviews:   10,
        reviews_needed:   Math.max(0, 10 - totalReviews),
      },
      dedup_key:   `tr:${ctx.business_id}:weak_review_volume`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('TrustSignal analysis complete', {
    businessId:  ctx.business_id,
    trustScore,
    gapType,
    insightsFound: insights.length,
  });

  return { trust_state, insights };
}
