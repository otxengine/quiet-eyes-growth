/**
 * InsightFusion — Context & Fusion Layer
 *
 * Takes an EnrichedContext and produces a single FusedInsight:
 *  - Identifies the highest-leverage opportunity
 *  - Assigns urgency based on multi-signal + opportunity/threat analysis
 *  - Computes confidence from data quality
 *  - Determines primary_type ('opportunity'|'threat'|'mixed')
 *  - Builds contributing_items[] for full traceability
 *  - Suggests action_types for DecisionEngine
 *  - Uses Claude for insight synthesis
 */

import { nanoid } from 'nanoid';
import {
  EnrichedContext, FusedInsight, ContributingItem, ActionType,
} from '../../models';
import { invokeLLM } from '../../lib/llm';
import { createLogger } from '../../infra/logger';
import { bus } from '../../events/EventBus';

const logger = createLogger('InsightFusion');

// ─── Primary type ─────────────────────────────────────────────────────────────

function computePrimaryType(ctx: EnrichedContext): FusedInsight['primary_type'] {
  const hasOpps    = ctx.active_opportunities.length > 0;
  const hasThreats = ctx.active_threats.length > 0;
  if (hasOpps && hasThreats) return 'mixed';
  if (hasThreats) return 'threat';
  return 'opportunity';
}

// ─── Urgency scoring ─────────────────────────────────────────────────────────

function computeUrgency(ctx: EnrichedContext): 'low' | 'medium' | 'high' | 'critical' {
  let score = 0;

  // Negative reviews spike
  if (ctx.reviews.negative_last7d >= 5) score += 3;
  else if (ctx.reviews.negative_last7d >= 2) score += 1;

  // High-urgency signals
  if (ctx.signals.high_urgency >= 5) score += 3;
  else if (ctx.signals.high_urgency >= 2) score += 1;

  // Health score below threshold
  if (ctx.health_score !== null && ctx.health_score < 40) score += 2;

  // Hot leads not followed up
  if (ctx.leads.hot >= 3) score += 1;

  // Active critical predictions
  const criticalPreds = ctx.active_predictions.filter(
    p => p.impact === 'high' && (p.confidence ?? 0) > 0.7,
  );
  if (criticalPreds.length > 0) score += 2;

  // Boost from active opportunities/threats
  const criticalOpps = ctx.active_opportunities.filter(o => o.urgency === 'critical').length;
  const highOpps     = ctx.active_opportunities.filter(o => o.urgency === 'high').length;
  const criticalThreats = ctx.active_threats.filter(t => t.urgency === 'critical').length;
  const highThreats     = ctx.active_threats.filter(t => t.urgency === 'high').length;
  score += criticalOpps * 2 + highOpps * 1 + criticalThreats * 3 + highThreats * 1;

  if (score >= 6) return 'critical';
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function computeConfidence(ctx: EnrichedContext): number {
  let score = 0;
  let weight = 0;

  // Data richness
  if (ctx.signals.total > 20) { score += 1.0; weight += 1; }
  else if (ctx.signals.total > 5) { score += 0.6; weight += 1; }
  else { score += 0.3; weight += 1; }

  // Competitor data
  if (ctx.competitors.length > 3) { score += 0.9; weight += 1; }
  else if (ctx.competitors.length > 0) { score += 0.5; weight += 1; }

  // Health score available
  if (ctx.health_score !== null) { score += 0.8; weight += 1; }

  // Memory available (learned preferences)
  if (ctx.memory) { score += 0.9; weight += 1; }

  // Reviews data
  if (ctx.reviews.total > 10) { score += 0.85; weight += 1; }
  else if (ctx.reviews.total > 0) { score += 0.5; weight += 1; }

  // Opportunity detections boost confidence
  if (ctx.active_opportunities.length > 0) { score += 0.8; weight += 1; }

  return weight > 0 ? Math.round((score / weight) * 1000) / 1000 : 0.5;
}

// ─── Contributing items ───────────────────────────────────────────────────────

function buildContributingItems(ctx: EnrichedContext): ContributingItem[] {
  const items: ContributingItem[] = [];

  // Top signals
  for (const s of ctx.recent_signals.slice(0, 5)) {
    items.push({
      type:  'signal',
      id:    s.id,
      label: s.summary.slice(0, 60),
      score: s.impact_level === 'high' ? 0.9 : s.impact_level === 'medium' ? 0.6 : 0.3,
    });
  }

  // Opportunities
  for (const o of ctx.active_opportunities) {
    items.push({
      type:  'opportunity',
      id:    o.id,
      label: `${o.type}: ${o.explanation.slice(0, 60)}`,
      score: o.opportunity_score,
    });
  }

  // Threats
  for (const t of ctx.active_threats) {
    items.push({
      type:  'threat',
      id:    t.id,
      label: `${t.type}: ${t.explanation.slice(0, 60)}`,
      score: t.risk_score,
    });
  }

  // Forecasts
  for (const f of ctx.forecasts.slice(0, 2)) {
    items.push({
      type:  'forecast',
      id:    (f as any).id ?? `fc_${nanoid(6)}`,
      label: `demand ${f.expected_demand_score > 70 ? 'high' : 'normal'}`,
      score: f.confidence,
    });
  }

  return items;
}

// ─── Context summary for LLM ─────────────────────────────────────────────────

function buildContextSummary(ctx: EnrichedContext): string {
  const parts: string[] = [
    `עסק: ${ctx.profile.name} (${ctx.profile.category}, ${ctx.profile.city})`,
    `בריאות עסקית: ${ctx.health_score ?? 'לא ידוע'}/100`,
    `לידים: ${ctx.leads.total} סה"כ | ${ctx.leads.hot} חמים | ${ctx.leads.warm} פושרים | ${ctx.leads.new} חדשים`,
    `ביקורות: ${ctx.reviews.total} סה"כ | ממוצע ${ctx.reviews.avg_rating ?? '?'} | ${ctx.reviews.negative_last7d} שליליות ב-7 ימים`,
    `אותות שוק: ${ctx.signals.total} סה"כ | ${ctx.signals.high_urgency} דחופים`,
    `מתחרים: ${ctx.competitors.length}`,
  ];

  if (ctx.active_opportunities.length > 0) {
    parts.push(`הזדמנויות זוהו (${ctx.active_opportunities.length}): ${
      ctx.active_opportunities.slice(0, 2).map(o => `${o.type}(${o.urgency})`).join(', ')
    }`);
  }

  if (ctx.active_threats.length > 0) {
    parts.push(`איומים זוהו (${ctx.active_threats.length}): ${
      ctx.active_threats.slice(0, 2).map(t => `${t.type}(${t.urgency})`).join(', ')
    }`);
  }

  if (ctx.memory?.preferred_tone) {
    parts.push(`סגנון מועדף: ${ctx.memory.preferred_tone}`);
  }

  if (ctx.trends && ctx.trends.length > 0) {
    const topTrend = ctx.trends.slice().sort((a, b) => b.z_score - a.z_score)[0];
    parts.push(`טרנד מוביל: ${topTrend.keyword} (z=${topTrend.z_score.toFixed(1)})`);
  }

  if (ctx.active_predictions.length > 0) {
    parts.push(`תחזיות פעילות: ${ctx.active_predictions.map(p => p.title).join(', ')}`);
  }

  if (ctx.memory?.rejected_patterns?.length) {
    parts.push(`תבניות שנדחו: ${ctx.memory.rejected_patterns.slice(0, 3).join(', ')}`);
  }

  return parts.join('\n');
}

// ─── Main fusion function ─────────────────────────────────────────────────────

export async function fuseInsight(ctx: EnrichedContext): Promise<FusedInsight> {
  const insightId = `ins_${nanoid(12)}`;

  logger.info('Fusing insight', {
    businessId:   ctx.business_id,
    signalCount:  ctx.signals.total,
    opportunities: ctx.active_opportunities.length,
    threats:       ctx.active_threats.length,
    traceId:       ctx.trace_id ?? '',
  });

  const urgency      = computeUrgency(ctx);
  const confidence   = computeConfidence(ctx);
  const primaryType  = computePrimaryType(ctx);
  const contribItems = buildContributingItems(ctx);

  // Build LLM prompt
  const contextSummary = buildContextSummary(ctx);
  const result = await invokeLLM({
    prompt: `אתה מנתח עסקי ישראלי בכיר. נתח את הנתונים הבאים וזהה את ההזדמנות המרכזית ביותר לעסק.

${contextSummary}

אותות שוק רלוונטיים (${ctx.signals.total} סה"כ):
${ctx.recent_signals.slice(0, 5).map(s =>
  `- [impact=${s.impact_level ?? 'medium'}] ${s.summary.slice(0, 80)}`
).join('\n') || '(אין אותות)'}

${ctx.forecasts.length > 0 ? `תחזיות ביקוש:
${ctx.forecasts.slice(0, 2).map(f => `- ${f.forecast_window}: demand=${f.expected_demand_score} (confidence=${f.confidence})`).join('\n')}` : ''}

הנחיות:
1. זהה הזדמנות ספציפית ומדידה (לא כללית)
2. הסבר את ההשפעה הצפויה
3. ציין 2-3 סוגי פעולה מומלצים
4. התחשב בדפוסים שנדחו: ${ctx.memory?.rejected_patterns?.slice(0, 3).join(', ') || 'אין'}

JSON:
{
  "top_opportunity": "תיאור קצר וספציפי של ההזדמנות",
  "top_summary": "כותרת אחת קצרה לכרטיס ה-UI (עד 8 מילים)",
  "expected_business_impact": "השפעה עסקית צפויה: X% יותר לידים / Y שקל רווח / Z ביקורות",
  "explanation": "2-3 משפטים מפורטים המסבירים את הניתוח",
  "key_signals": ["אות1", "אות2", "אות3"],
  "suggested_action_types": ["content|campaign|promotion|outreach|reputation|retention|pricing|expansion|competitor_response|alert"]
}`,
    response_json_schema: { type: 'object' },
  });

  const top_opportunity         = result?.top_opportunity || `הזדמנות זוהתה — ביקוש ${urgency}`;
  const top_summary             = result?.top_summary || top_opportunity.slice(0, 60);
  const expected_business_impact = result?.expected_business_impact || result?.expected_impact || 'השפעה לא כומתה';
  const explanation              = result?.explanation || '';

  // Extract suggested action types from LLM result, validate against known types
  const VALID_ACTIONS = new Set([
    'content','campaign','promotion','outreach','reputation',
    'retention','pricing','expansion','competitor_response','alert',
  ]);
  const suggested_action_types: ActionType[] = [];
  for (const t of (result?.suggested_action_types ?? [])) {
    if (VALID_ACTIONS.has(t)) suggested_action_types.push(t as ActionType);
  }
  // Fallback: map urgency to candidates
  if (suggested_action_types.length === 0) {
    if (urgency === 'critical') suggested_action_types.push('reputation', 'alert');
    else if (urgency === 'high') suggested_action_types.push('campaign', 'outreach');
    else suggested_action_types.push('content');
  }

  const insight: FusedInsight = {
    id:                       insightId,
    business_id:              ctx.business_id,
    trace_id:                 ctx.trace_id ?? '',
    primary_type:             primaryType,
    top_summary,
    top_opportunity,
    urgency,
    confidence,
    expected_business_impact,
    expected_impact:          expected_business_impact,
    explanation,
    contributing_items:       contribItems,
    contributing_signals:     ctx.recent_signals.slice(0, 10).map(s => s.id),
    suggested_action_types,
    raw_signals_count:        ctx.signals.total,
    trends_count:             ctx.trends.length,
    created_at:               new Date().toISOString(),
  };

  // Emit event
  await bus.emit(bus.makeEvent('insight.fused', ctx.business_id, {
    insight_id:           insightId,
    business_id:          ctx.business_id,
    top_opportunity,
    urgency,
    confidence,
    contributing_signals: ctx.signals.total,
    expected_impact:      expected_business_impact,
  }, ctx.trace_id ?? ''));

  logger.info('Insight fused', {
    insightId,
    urgency,
    confidence,
    primaryType,
    actionSuggestions: suggested_action_types,
    businessId: ctx.business_id,
  });

  return insight;
}
