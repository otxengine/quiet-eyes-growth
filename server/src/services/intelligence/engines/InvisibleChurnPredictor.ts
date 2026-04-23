/**
 * InvisibleChurnPredictor — Intelligence Engine
 *
 * Detects churn risk from EXTERNAL signals — not from CRM data.
 * Identifies early warning signals before customers explicitly leave:
 * - Review sentiment velocity decline
 * - Competitor attraction signals (competitors rising + our metrics flat)
 * - Engagement proxy drops (signal volume decline, lead conversion stall)
 * - Seasonal churn windows
 *
 * Returns:
 * - ChurnRiskState: quantified risk level + indicators
 * - Insight[]: retention-focused insights
 *
 * Insight types: 'invisible_churn'
 * Category: 'retention'
 */

import { nanoid } from 'nanoid';
import type { EnrichedContext, Insight, ChurnRiskState } from '../../../models';
import { createLogger } from '../../../infra/logger';

const logger = createLogger('InvisibleChurnPredictor');

const ENGINE = 'InvisibleChurnPredictor';

export interface ChurnAnalysis {
  churn_risk_state: ChurnRiskState;
  insights:         Insight[];
}

export function predictInvisibleChurn(ctx: EnrichedContext): ChurnAnalysis {
  const insights:   Insight[] = [];
  const indicators: string[]  = [];
  let riskScore = 0;

  // ── Signal 1: Negative review velocity ────────────────────────────────────
  const negLast7d = ctx.reviews.negative_last7d;
  if (negLast7d >= 2) {
    const negContribution = Math.min(0.25, negLast7d * 0.05);
    riskScore += negContribution;
    indicators.push(`${negLast7d} ביקורות שליליות ב-7 ימים`);
  }

  // ── Signal 2: Low review average + high competitor ratings ────────────────
  const avgRating   = ctx.reviews.avg_rating ?? 0;
  const avgCompRating = ctx.competitors.length > 0
    ? ctx.competitors
        .filter(c => c.rating !== null)
        .reduce((s, c) => s + (c.rating ?? 0), 0) /
      Math.max(1, ctx.competitors.filter(c => c.rating !== null).length)
    : avgRating;

  if (avgRating > 0 && avgRating < avgCompRating - 0.3) {
    const ratingGap = avgCompRating - avgRating;
    riskScore += Math.min(0.20, ratingGap * 0.10);
    indicators.push(`דירוג ${avgRating.toFixed(1)} מול מתחרים ${avgCompRating.toFixed(1)}`);
  }

  // ── Signal 3: Rising competitors (customer attraction) ────────────────────
  const risingCompetitors = ctx.competitors.filter(c => c.trend_direction === 'rising');
  if (risingCompetitors.length >= 1) {
    riskScore += Math.min(0.20, risingCompetitors.length * 0.08);
    indicators.push(`${risingCompetitors.length} מתחרים עם מגמת עלייה`);
  }

  // ── Signal 4: Lead drop (warm leads stalling) ─────────────────────────────
  if (ctx.leads.total < 5 && ctx.leads.hot === 0) {
    riskScore += 0.15;
    indicators.push(`מחסור בלידים פעילים (${ctx.leads.total} סה"כ)`);
  }

  // ── Signal 5: Low health score ─────────────────────────────────────────────
  const healthScore = ctx.health_score ?? 50;
  if (healthScore < 40) {
    riskScore += Math.min(0.20, (40 - healthScore) / 40 * 0.20);
    indicators.push(`ציון בריאות נמוך: ${healthScore}/100`);
  }

  // ── Signal 6: Demand forecast decline ─────────────────────────────────────
  const dropForecast = ctx.forecasts.find(f => f.demand_delta_pct < -10);
  if (dropForecast) {
    riskScore += Math.min(0.15, Math.abs(dropForecast.demand_delta_pct) / 100);
    indicators.push(`תחזית ירידת ביקוש: ${Math.round(dropForecast.demand_delta_pct)}%`);
  }

  // ── Signal 7: Demand forecast decline with pending responses ──────────────
  if (ctx.reviews.pending_response >= 5) {
    riskScore += 0.10;
    indicators.push(`${ctx.reviews.pending_response} ביקורות ללא מענה`);
  }

  // ── Normalise risk score ───────────────────────────────────────────────────
  riskScore = Math.min(1, riskScore);

  // ── Risk level ─────────────────────────────────────────────────────────────
  const riskLevel: ChurnRiskState['risk_level'] =
    riskScore >= 0.70 ? 'critical' :
    riskScore >= 0.50 ? 'high' :
    riskScore >= 0.30 ? 'medium' : 'low';

  // Estimated churn % based on risk score (empirical approximation)
  const estimatedChurnPct = Math.min(0.35, riskScore * 0.4);

  const topFactor = indicators[0] ?? 'סיכון כללי נמוך';

  const churn_risk_state: ChurnRiskState = {
    risk_level:           riskLevel,
    risk_score:           Math.round(riskScore * 1000) / 1000,
    indicators,
    estimated_churn_pct:  Math.round(estimatedChurnPct * 100) / 100,
    top_risk_factor:      topFactor,
    window_days:          30,
  };

  // ── Generate retention insights ────────────────────────────────────────────

  if (riskLevel === 'critical' || riskLevel === 'high') {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'invisible_churn',
      category:    'retention',
      title:       `סיכון נטישה ${riskLevel === 'critical' ? 'קריטי' : 'גבוה'}: ${Math.round(estimatedChurnPct * 100)}% לקוחות בסכנה`,
      summary:     `${indicators.length} מדדי שוק חיצוניים מצביעים על סיכון נטישה מוגבר. הגורם המרכזי: ${topFactor}. נדרשת פעולת שימור אקטיבית לפני שלקוחות יעזבו ללא הודעה.`,
      supporting_signals:       ctx.recent_signals.slice(0, 3).map(s => s.id),
      confidence:  0.72,
      urgency:     riskLevel === 'critical' ? 'critical' : 'high',
      business_fit: 0.90,
      timeframe:   '7d',
      estimated_impact: 'high',
      recommended_action_types: ['retention', 'outreach', 'reputation'],
      metadata: {
        risk_score:            Math.round(riskScore * 100),
        risk_level:            riskLevel,
        estimated_churn_pct:   Math.round(estimatedChurnPct * 100),
        top_factor:            topFactor,
        indicator_count:       indicators.length,
      },
      dedup_key:   `ic:${ctx.business_id}:high_churn_risk`,
      created_at:  new Date().toISOString(),
    });
  }

  if (riskLevel === 'medium') {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'invisible_churn',
      category:    'retention',
      title:       `אותות נטישה מוקדמים — נדרשת מניעה`,
      summary:     `${indicators.slice(0, 2).join('; ')}. הסיכון בשלב מוקדם — פעולה כעת תמנע נטישה עתידית בעלות נמוכה.`,
      supporting_signals:       [],
      confidence:  0.62,
      urgency:     'medium',
      business_fit: 0.80,
      timeframe:   '30d',
      estimated_impact: 'medium',
      recommended_action_types: ['retention', 'content'],
      metadata: {
        risk_score:   Math.round(riskScore * 100),
        risk_level:   riskLevel,
        indicators:   indicators.slice(0, 3),
      },
      dedup_key:   `ic:${ctx.business_id}:medium_churn_risk`,
      created_at:  new Date().toISOString(),
    });
  }

  // Specific insight: competitor attraction
  if (risingCompetitors.length >= 2) {
    insights.push({
      id:          `ins_${nanoid(10)}`,
      business_id: ctx.business_id,
      engine:      ENGINE,
      type:        'invisible_churn',
      category:    'retention',
      title:       `מתחרים שואבים לקוחות: ${risingCompetitors.length} מתחרים בעלייה`,
      summary:     `${risingCompetitors.map(c => c.name).join(', ')} מציגים מגמת עלייה ועשויים למשוך לקוחות קיימים. קמפיין נאמנות ו-cross-sell ישמר את הבסיס.`,
      supporting_signals:       [],
      confidence:  0.75,
      urgency:     'high',
      business_fit: 0.85,
      timeframe:   '7d',
      estimated_impact: 'high',
      recommended_action_types: ['retention', 'competitor_response', 'campaign'],
      metadata: {
        rising_competitors: risingCompetitors.map(c => c.name),
        competitor_count:   risingCompetitors.length,
      },
      dedup_key:   `ic:${ctx.business_id}:competitor_attraction`,
      created_at:  new Date().toISOString(),
    });
  }

  logger.debug('InvisibleChurn prediction complete', {
    businessId: ctx.business_id,
    riskLevel,
    riskScore: Math.round(riskScore * 100),
    insightsFound: insights.length,
  });

  return { churn_risk_state, insights };
}
