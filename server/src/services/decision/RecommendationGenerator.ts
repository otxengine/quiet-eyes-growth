/**
 * RecommendationGenerator — converts Decisions into user-facing Recommendations.
 *
 * For each decision:
 * 1. Builds a Hebrew structured recommendation with full traceability
 * 2. If execution_mode='draft'|'auto', generates pre-written content
 * 3. Persists to otx_recommendations with full traceability chain
 * 4. Syncs to Action table (existing UI visibility)
 * 5. Emits recommendation.generated event
 *
 * TRACEABILITY: every recommendation links back to
 *   signal_ids → opportunity_ids → insight_id → decision_id
 */

import { nanoid } from 'nanoid';
import {
  Decision, EnrichedContext, Recommendation, RecommendationUIPayload, UrgencyLevel,
} from '../../models';
import { decisionRepository } from '../../repositories/DecisionRepository';
import { invokeLLM } from '../../lib/llm';
import { prisma } from '../../db';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';

const logger = createLogger('RecommendationGenerator');

const CHANNEL_MAP: Record<string, string> = {
  content:             'instagram',
  campaign:            'facebook',
  promotion:           'whatsapp',
  outreach:            'whatsapp',
  reputation:          'google',
  retention:           'whatsapp',
  pricing:             'internal',
  expansion:           'internal',
  competitor_response: 'internal',
  alert:               'dashboard',
};

// ─── Build traceability chain ─────────────────────────────────────────────────

function buildTraceability(decision: Decision, ctx: EnrichedContext) {
  const opportunityIds  = ctx.active_opportunities.map(o => o.id);
  const signalIds       = ctx.recent_signals.slice(0, 10).map(s => s.id);
  return { opportunityIds, signalIds };
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateRecommendation(
  decision: Decision,
  ctx: EnrichedContext,
): Promise<Recommendation> {
  const channel   = CHANNEL_MAP[decision.action_type] ?? 'dashboard';
  const tone      = ctx.memory?.preferred_tone ?? 'professional';
  const needsDraft = decision.execution_mode === 'draft' || decision.execution_mode === 'auto';
  const { opportunityIds, signalIds } = buildTraceability(decision, ctx);

  logger.info('Generating recommendation', {
    decisionId: decision.id,
    actionType: decision.action_type,
    mode:       decision.execution_mode,
  });

  // Build threat/opportunity context for LLM
  const oppContext = ctx.active_opportunities.length > 0
    ? `הזדמנויות זוהו: ${ctx.active_opportunities.map(o => o.explanation).slice(0, 2).join(' | ')}`
    : '';
  const thrContext = ctx.active_threats.length > 0
    ? `איומים זוהו: ${ctx.active_threats.map(t => t.explanation).slice(0, 2).join(' | ')}`
    : '';

  const prompt = `אתה מייעץ עסקי לעסקים ישראלים קטנים. הכן המלצה מפורטת ושימושית.

עסק: ${ctx.profile.name} (${ctx.profile.category}, ${ctx.profile.city})
החלטה: ${decision.title}
סוג פעולה: ${decision.action_type}
ניתוח: ${decision.decision_reasoning}
ביטחון: ${Math.round(decision.confidence * 100)}%
ערוץ: ${channel}
סגנון: ${tone}

נתוני הקשר:
- לידים חמים: ${ctx.leads.hot}
- ביקורות שליליות (7 ימים): ${ctx.reviews.negative_last7d}
- ציון בריאות: ${ctx.health_score ?? 'לא ידוע'}/100
${oppContext ? `- ${oppContext}` : ''}
${thrContext ? `- ${thrContext}` : ''}
${ctx.trends.length > 0 ? `- טרנד: ${ctx.trends[0]?.keyword ?? ''}` : ''}

הנחיות:
- summary: משפט אחד קצר לכרטיס ה-UI
- why_now: הסבר בין 1-2 משפטים למה עכשיו הזמן הנכון
- body: 2-3 משפטים מפורטים
- cta: קריאה לפעולה ספציפית ואחת בלבד
- recommended_steps: 3 צעדים ברורים ומיידיים
- estimated_impact: הערכה כמותית (אחוזים, שקלים, לידים)
- recommended_timing: מתי לבצע (כמה שעות/ימים מעכשיו)
${needsDraft ? `- draft_content: טקסט מוכן לשליחה ב${channel} (עד 120 מילה)` : ''}

JSON:
{
  "title": "כותרת קצרה וממוקדת",
  "summary": "משפט אחד לכרטיס",
  "why_now": "למה עכשיו",
  "body": "הסבר מלא",
  "cta": "קריאה לפעולה",
  "estimated_impact": "השפעה צפויה",
  "recommended_steps": ["צעד 1", "צעד 2", "צעד 3"],
  "recommended_timing": "תוך 24 שעות"${needsDraft ? ',\n  "draft_content": "תוכן מוכן"' : ''}
}`;

  const result = await invokeLLM({ prompt, response_json_schema: { type: 'object' } });

  const recId  = `rec_${nanoid(12)}`;
  const urgency: UrgencyLevel = decision.score >= 80 ? 'high' : decision.score >= 60 ? 'medium' : 'low';
  const now    = new Date().toISOString();

  // Build full UI payload for traceability
  const userVisiblePayload: RecommendationUIPayload = {
    title:           result?.title || decision.title,
    summary:         result?.summary || result?.body?.slice(0, 100) || decision.title,
    why_now:         result?.why_now || '',
    expected_impact: result?.estimated_impact || '',
    steps:           result?.recommended_steps || [],
    channel,
    urgency,
    confidence:      decision.confidence,
    trace: {
      signal_count:    signalIds.length,
      opportunity_ids: opportunityIds,
      insight_id:      decision.fused_insight_id,
      decision_id:     decision.id,
    },
  };

  const rec: Recommendation = {
    id:                   recId,
    business_id:          ctx.business_id,
    decision_id:          decision.id,
    trace_id:             ctx.trace_id ?? '',
    insight_id:           decision.fused_insight_id,
    opportunity_ids:      opportunityIds,
    signal_ids:           signalIds,
    title:                result?.title || decision.title,
    summary:              result?.summary || result?.body?.slice(0, 100) || decision.title,
    body:                 result?.body || decision.decision_reasoning,
    why_now:              result?.why_now || '',
    cta:                  result?.cta || 'פעל עכשיו',
    channel,
    recommended_channel:  channel,
    urgency,
    estimated_impact:     result?.estimated_impact || '',
    expected_impact:      result?.estimated_impact || '',
    recommended_steps:    result?.recommended_steps || [],
    action_steps:         result?.recommended_steps || [],
    recommended_timing:   result?.recommended_timing || null,
    draft_content:        needsDraft ? result?.draft_content : undefined,
    user_visible_payload: userVisiblePayload,
    status:               'pending',
    created_at:           now,
  };

  // Persist
  await decisionRepository.saveRecommendation(rec);

  // Sync to Action table (legacy UI)
  await prisma.action.create({
    data: {
      linked_business: ctx.business_id,
      type:            decision.action_type,
      title:           rec.title,
      reasoning:       `[score=${decision.score}] ${rec.body}`,
      impact_estimate: rec.estimated_impact,
      execution_plan:  rec.recommended_steps.join('\n') || rec.cta,
      status:          'proposed',
      created_at:      now,
    },
  }).catch(e => logger.warn('Action sync failed', { error: e.message }));

  await bus.emit(bus.makeEvent('recommendation.generated', ctx.business_id, {
    event_id:          `evt_${nanoid(8)}`,
    recommendation_id: recId,
    decision_id:       decision.id,
    business_id:       ctx.business_id,
    generated_at:      now,
  }, ctx.trace_id ?? ''));

  logger.info('Recommendation generated', {
    recId, decisionId: decision.id, urgency, channel,
  });

  return rec;
}

/** Batch generation */
export async function generateRecommendations(
  decisions: Decision[],
  ctx: EnrichedContext,
): Promise<Recommendation[]> {
  const recs: Recommendation[] = [];
  for (const decision of decisions) {
    try {
      recs.push(await generateRecommendation(decision, ctx));
    } catch (err: any) {
      logger.error('Recommendation generation failed', {
        decisionId: decision.id, error: err.message,
      });
    }
  }
  return recs;
}
