/**
 * ExplainabilityService — first-class explainability layer.
 *
 * Generates and persists human-readable explanations for:
 *   - FusedInsight (InsightExplanation)
 *   - Decision     (DecisionExplanation)
 *   - Recommendation (RecommendationExplanation)
 *   - LearningUpdate (LearningExplanation)
 *
 * Product-facing text is derived from actual system state, not generic templates.
 * Only medium/high significance changes produce user-visible learning summaries.
 */

import { nanoid }     from 'nanoid';
import { prisma }     from '../../db';
import { createLogger } from '../../infra/logger';
import type { SignificanceLevel } from '../../infra/AuditLogger';

const logger = createLogger('ExplainabilityService');

// ─── Explanation types ────────────────────────────────────────────────────────

export interface ContributingFactor {
  label:       string;    // human-readable factor name
  value:       number;    // 0–1 or actual score
  description: string;   // brief explanation of why it matters
}

export interface ConfidenceBreakdown {
  base_confidence:            number;
  signal_freshness_penalty:   number;
  novelty_boost:              number;
  historical_alignment_boost: number;
  final_confidence:           number;
}

export interface InsightExplanation {
  id:                    string;
  fused_insight_id:      string;
  business_id:           string;
  contributing_signals:  string[];   // signal_ids
  contributing_events:   string[];   // event_ids
  contributing_forecasts: string[];  // forecast_ids
  top_factors:           ContributingFactor[];
  reasoning_summary:     string;
  confidence_breakdown:  ConfidenceBreakdown;
  created_at:            string;
}

export interface ScoreBreakdown {
  expected_roi:       number;   // 0–100
  confidence:         number;   // 0–1
  business_fit:       number;   // 0–100
  timing_fit:         number;   // 0–100
  historical_success: number;   // 0–100
  final_score:        number;   // 0–100
}

export interface DecisionExplanation {
  id:                     string;
  decision_id:            string;
  business_id:            string;
  chosen_action_type:     string;
  rejected_action_types:  string[];
  score_breakdown:        ScoreBreakdown;
  policy_checks_passed:   string[];
  policy_checks_failed:   string[];
  reasoning_summary:      string;
  memory_factors_used:    string[];  // e.g. ['preferred_channel:internal', 'peak_hours:10-12']
  created_at:             string;
}

export interface RecommendationExplanation {
  id:                      string;
  recommendation_id:       string;
  business_id:             string;
  why_now:                 string;
  why_this_channel:        string;
  why_this_timing:         string;
  expected_impact_reasoning: string;
  supporting_patterns:     string[];
  created_at:              string;
}

export interface WeightChange {
  agent_name:   string;
  action_type:  string;
  old_weight:   number;
  new_weight:   number;
  delta:        number;
  direction:    'up' | 'down' | 'stable';
}

export interface ConfidenceChange {
  dimension:     string;
  old_confidence: number;
  new_confidence: number;
  delta:          number;
}

export interface LearningExplanation {
  id:                      string;
  business_id:             string;
  update_source_type:      'feedback' | 'outcome' | 'override' | 'cycle';
  update_source_id:        string;
  updated_weights:         WeightChange[];
  updated_preferences:     string[];
  rejected_patterns_added: string[];
  confidence_changes:      ConfidenceChange[];
  reasoning_summary:       string;
  significance:            SignificanceLevel;
  is_short_term:           boolean;
  created_at:              string;
}

// ─── InsightExplanation ───────────────────────────────────────────────────────

export async function buildInsightExplanation(params: {
  fusedInsightId:      string;
  businessId:          string;
  signalIds:           string[];
  eventIds:            string[];
  forecastIds:         string[];
  urgency:             string;
  primaryType:         'opportunity' | 'threat' | 'mixed';
  confidence:          number;
  confidenceBreakdown: ConfidenceBreakdown;
  topFactors:          ContributingFactor[];
}): Promise<InsightExplanation> {
  const id  = `iex_${nanoid(12)}`;
  const now = new Date().toISOString();

  const reasoning = _buildInsightReasoning(params);

  const explanation: InsightExplanation = {
    id,
    fused_insight_id:       params.fusedInsightId,
    business_id:            params.businessId,
    contributing_signals:   params.signalIds,
    contributing_events:    params.eventIds,
    contributing_forecasts: params.forecastIds,
    top_factors:            params.topFactors,
    reasoning_summary:      reasoning,
    confidence_breakdown:   params.confidenceBreakdown,
    created_at:             now,
  };

  await _persistInsightExplanation(explanation);
  return explanation;
}

function _buildInsightReasoning(params: {
  signalIds: string[];
  eventIds:  string[];
  forecastIds: string[];
  urgency:   string;
  primaryType: 'opportunity' | 'threat' | 'mixed';
  confidence: number;
  topFactors: ContributingFactor[];
}): string {
  const parts: string[] = [];

  if (params.primaryType === 'opportunity') {
    parts.push('הזדמנות זו זוהתה על בסיס ניתוח נתונים עדכני.');
  } else if (params.primaryType === 'threat') {
    parts.push('זוהתה סכנה פוטנציאלית הדורשת תשומת לב.');
  } else {
    parts.push('הניתוח מזהה גם הזדמנויות וגם סיכונים.');
  }

  const sources: string[] = [];
  if (params.signalIds.length > 0)   sources.push(`${params.signalIds.length} אותות`);
  if (params.eventIds.length > 0)    sources.push(`${params.eventIds.length} אירועים`);
  if (params.forecastIds.length > 0) sources.push(`${params.forecastIds.length} תחזיות`);
  if (sources.length > 0) parts.push(`מקורות: ${sources.join(', ')}.`);

  const topFactor = params.topFactors[0];
  if (topFactor) {
    parts.push(`הגורם המוביל: ${topFactor.label} (${(topFactor.value * 100).toFixed(0)}%) — ${topFactor.description}`);
  }

  if (params.urgency === 'critical' || params.urgency === 'high') {
    parts.push('רמת הדחיפות גבוהה — מומלץ לפעול בהקדם.');
  }

  if (params.confidence < 0.5) {
    parts.push('רמת הביטחון נמוכה — מומלץ לוודא נתונים נוספים לפני פעולה.');
  }

  return parts.join(' ');
}

// ─── DecisionExplanation ──────────────────────────────────────────────────────

export async function buildDecisionExplanation(params: {
  decisionId:           string;
  businessId:           string;
  chosenActionType:     string;
  rejectedActionTypes:  string[];
  scoreBreakdown:       ScoreBreakdown;
  policyChecksPassed:   string[];
  policyChecksFailed:   string[];
  memoryFactorsUsed:    string[];
}): Promise<DecisionExplanation> {
  const id  = `dex_${nanoid(12)}`;
  const now = new Date().toISOString();

  const reasoning = _buildDecisionReasoning(params);

  const explanation: DecisionExplanation = {
    id,
    decision_id:            params.decisionId,
    business_id:            params.businessId,
    chosen_action_type:     params.chosenActionType,
    rejected_action_types:  params.rejectedActionTypes,
    score_breakdown:        params.scoreBreakdown,
    policy_checks_passed:   params.policyChecksPassed,
    policy_checks_failed:   params.policyChecksFailed,
    reasoning_summary:      reasoning,
    memory_factors_used:    params.memoryFactorsUsed,
    created_at:             now,
  };

  await _persistDecisionExplanation(explanation);
  return explanation;
}

function _buildDecisionReasoning(params: {
  chosenActionType:    string;
  scoreBreakdown:      ScoreBreakdown;
  policyChecksPassed:  string[];
  policyChecksFailed:  string[];
  memoryFactorsUsed:   string[];
}): string {
  const parts: string[] = [];
  const s = params.scoreBreakdown;

  parts.push(`הפעולה "${params.chosenActionType}" נבחרה עם ציון כולל ${s.final_score.toFixed(0)}/100.`);

  if (s.historical_success >= 70) {
    parts.push('פעולות דומות הצליחו בעבר ברמה גבוהה.');
  } else if (s.historical_success < 40) {
    parts.push('היסטוריית הצלחה נמוכה — ממליץ על מעקב הדוק.');
  }

  if (s.timing_fit >= 75) {
    parts.push('התזמון מתאים לדפוסי הפעילות של העסק.');
  }

  if (s.business_fit >= 75) {
    parts.push('הפעולה מתאימה לפרופיל ולהעדפות העסק.');
  }

  if (params.policyChecksFailed.length > 0) {
    parts.push(`מגבלות מדיניות: ${params.policyChecksFailed.join(', ')}.`);
  }

  const memPrefs = params.memoryFactorsUsed.filter(f => f.startsWith('preferred_'));
  if (memPrefs.length > 0) {
    parts.push('ההמלצה מותאמת להעדפות שנלמדו מהיסטוריית הפעילות.');
  }

  return parts.join(' ');
}

// ─── RecommendationExplanation ────────────────────────────────────────────────

export async function buildRecommendationExplanation(params: {
  recommendationId:       string;
  businessId:             string;
  actionType:             string;
  channel:                string;
  urgency:                string;
  recommendedTiming:      string | null;
  scoreBreakdown:         ScoreBreakdown;
  supportingPatterns:     string[];
  recentAcceptanceRate:   number;
  hasOverrideHistory:     boolean;
}): Promise<RecommendationExplanation> {
  const id  = `rex_${nanoid(12)}`;
  const now = new Date().toISOString();

  const explanation: RecommendationExplanation = {
    id,
    recommendation_id:         params.recommendationId,
    business_id:               params.businessId,
    why_now:                   _whyNow(params),
    why_this_channel:          _whyChannel(params.channel, params.scoreBreakdown.business_fit),
    why_this_timing:           _whyTiming(params.recommendedTiming, params.urgency),
    expected_impact_reasoning: _impactReasoning(params.scoreBreakdown),
    supporting_patterns:       params.supportingPatterns,
    created_at:                now,
  };

  await _persistRecommendationExplanation(explanation);
  return explanation;
}

function _whyNow(params: {
  urgency: string;
  scoreBreakdown: ScoreBreakdown;
  recentAcceptanceRate: number;
  supportingPatterns: string[];
}): string {
  if (params.urgency === 'critical') {
    return 'ההזדמנות הנוכחית היא קריטית וחלון הזמן מוגבל — נדרשת פעולה מיידית.';
  }
  if (params.recentAcceptanceRate >= 0.7) {
    return 'פעולות דומות התקבלו לאחרונה בשיעור גבוה — זהו עיתוי אופטימלי.';
  }
  if (params.supportingPatterns.length >= 2) {
    return `זוהו ${params.supportingPatterns.length} דפוסים תומכים המחזקים את הרלוונטיות כעת.`;
  }
  return 'הניתוח מצביע על עיתוי מתאים על בסיס הנתונים הנוכחיים.';
}

function _whyChannel(channel: string, businessFit: number): string {
  if (businessFit >= 80) {
    return `הערוץ "${channel}" מותאם מאוד לפרופיל ולהעדפות העסק.`;
  }
  if (channel === 'internal') {
    return 'ערוץ פנימי נבחר כברירת מחדל — אינו מחייב אישור.';
  }
  return `הערוץ "${channel}" נבחר על בסיס יעילות היסטורית.`;
}

function _whyTiming(recommendedTiming: string | null, urgency: string): string {
  if (urgency === 'critical' || urgency === 'high') {
    return 'פעולה מוקדמת מומלצת בשל דחיפות גבוהה.';
  }
  if (recommendedTiming) {
    const d = new Date(recommendedTiming);
    return `התזמון המיטבי מחושב לתאריך ${d.toLocaleDateString('he-IL')} בהתבסס על תחזיות ביקוש.`;
  }
  return 'פעולה יכולה להתבצע בעת הנוחה הקרובה.';
}

function _impactReasoning(s: ScoreBreakdown): string {
  const parts: string[] = [];
  if (s.expected_roi >= 70) {
    parts.push(`תשואה צפויה גבוהה (${s.expected_roi.toFixed(0)}/100).`);
  }
  if (s.confidence >= 0.75) {
    parts.push('רמת ביטחון גבוהה בהמלצה.');
  } else if (s.confidence < 0.5) {
    parts.push('ביטחון בינוני — ייתכן שתידרש בדיקה נוספת.');
  }
  return parts.length > 0 ? parts.join(' ') : 'השפעה צפויה חיובית על בסיס הנתונים הקיימים.';
}

// ─── LearningExplanation ─────────────────────────────────────────────────────

export async function buildLearningExplanation(params: {
  businessId:             string;
  updateSourceType:       'feedback' | 'outcome' | 'override' | 'cycle';
  updateSourceId:         string;
  updatedWeights:         WeightChange[];
  updatedPreferences:     string[];
  rejectedPatternsAdded:  string[];
  confidenceChanges:      ConfidenceChange[];
  significance:           SignificanceLevel;
  isShortTerm:            boolean;
}): Promise<LearningExplanation | null> {
  // Only persist medium/high significance changes
  if (params.significance === 'low') return null;

  const id  = `lex_${nanoid(12)}`;
  const now = new Date().toISOString();

  const reasoning = _buildLearningReasoning(params);

  const explanation: LearningExplanation = {
    id,
    business_id:             params.businessId,
    update_source_type:      params.updateSourceType,
    update_source_id:        params.updateSourceId,
    updated_weights:         params.updatedWeights,
    updated_preferences:     params.updatedPreferences,
    rejected_patterns_added: params.rejectedPatternsAdded,
    confidence_changes:      params.confidenceChanges,
    reasoning_summary:       reasoning,
    significance:            params.significance,
    is_short_term:           params.isShortTerm,
    created_at:              now,
  };

  await _persistLearningExplanation(explanation);
  return explanation;
}

function _buildLearningReasoning(params: {
  updateSourceType:      'feedback' | 'outcome' | 'override' | 'cycle';
  updatedWeights:        WeightChange[];
  rejectedPatternsAdded: string[];
  confidenceChanges:     ConfidenceChange[];
  significance:          SignificanceLevel;
  isShortTerm:           boolean;
}): string {
  const parts: string[] = [];

  const sourceLabel = {
    feedback: 'משוב משתמש',
    outcome:  'תוצאת פעולה',
    override: 'עקיפה ידנית',
    cycle:    'מחזור למידה תקופתי',
  }[params.updateSourceType];

  parts.push(`עדכון נובע מ: ${sourceLabel}.`);

  const upChanges  = params.updatedWeights.filter(w => w.direction === 'up');
  const downChanges = params.updatedWeights.filter(w => w.direction === 'down');

  if (upChanges.length > 0) {
    const top = upChanges.sort((a, b) => b.delta - a.delta)[0];
    parts.push(`משקל הפעולה "${top.action_type}" עלה ב-${(top.delta * 100).toFixed(1)}%.`);
  }

  if (downChanges.length > 0) {
    const top = downChanges.sort((a, b) => a.delta - b.delta)[0];
    parts.push(`משקל הפעולה "${top.action_type}" ירד ב-${(Math.abs(top.delta) * 100).toFixed(1)}%.`);
  }

  if (params.rejectedPatternsAdded.length > 0) {
    parts.push(`נוספו ${params.rejectedPatternsAdded.length} דפוסים לרשימת הדחויים.`);
  }

  if (params.updateSourceType === 'override') {
    parts.push('רמת הביטחון הופחתה כתוצאה מעקיפה ידנית.');
  }

  const termLabel = params.isShortTerm ? 'לטווח קצר' : 'לטווח ארוך';
  parts.push(`השינוי הוא ${termLabel}.`);

  return parts.join(' ');
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export async function getInsightExplanation(
  fusedInsightId: string,
  businessId: string,
): Promise<InsightExplanation | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM v3_insight_explanations WHERE fused_insight_id = $1 AND business_id = $2 LIMIT 1`,
    fusedInsightId, businessId,
  );
  return rows[0] ? _deserializeInsightExplanation(rows[0]) : null;
}

export async function getDecisionExplanation(
  decisionId: string,
  businessId: string,
): Promise<DecisionExplanation | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM v3_decision_explanations WHERE decision_id = $1 AND business_id = $2 LIMIT 1`,
    decisionId, businessId,
  );
  return rows[0] ? _deserializeDecisionExplanation(rows[0]) : null;
}

export async function getRecommendationExplanation(
  recommendationId: string,
  businessId: string,
): Promise<RecommendationExplanation | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM v3_recommendation_explanations WHERE recommendation_id = $1 AND business_id = $2 LIMIT 1`,
    recommendationId, businessId,
  );
  return rows[0] ? rows[0] : null;
}

// ─── Persist ─────────────────────────────────────────────────────────────────

async function _persistInsightExplanation(e: InsightExplanation): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO v3_insight_explanations
         (id, fused_insight_id, business_id, contributing_signals, contributing_events,
          contributing_forecasts, top_factors, reasoning_summary, confidence_breakdown, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      e.id, e.fused_insight_id, e.business_id,
      JSON.stringify(e.contributing_signals),
      JSON.stringify(e.contributing_events),
      JSON.stringify(e.contributing_forecasts),
      JSON.stringify(e.top_factors),
      e.reasoning_summary,
      JSON.stringify(e.confidence_breakdown),
      e.created_at,
    );
  } catch (err: any) {
    logger.warn('Failed to persist insight explanation', { id: e.id, error: err.message });
  }
}

async function _persistDecisionExplanation(e: DecisionExplanation): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO v3_decision_explanations
         (id, decision_id, business_id, chosen_action_type, rejected_action_types,
          score_breakdown, policy_checks_passed, policy_checks_failed,
          reasoning_summary, memory_factors_used, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      e.id, e.decision_id, e.business_id, e.chosen_action_type,
      JSON.stringify(e.rejected_action_types),
      JSON.stringify(e.score_breakdown),
      JSON.stringify(e.policy_checks_passed),
      JSON.stringify(e.policy_checks_failed),
      e.reasoning_summary,
      JSON.stringify(e.memory_factors_used),
      e.created_at,
    );
  } catch (err: any) {
    logger.warn('Failed to persist decision explanation', { id: e.id, error: err.message });
  }
}

async function _persistRecommendationExplanation(e: RecommendationExplanation): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO v3_recommendation_explanations
         (id, recommendation_id, business_id, why_now, why_this_channel,
          why_this_timing, expected_impact_reasoning, supporting_patterns, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      e.id, e.recommendation_id, e.business_id,
      e.why_now, e.why_this_channel, e.why_this_timing,
      e.expected_impact_reasoning,
      JSON.stringify(e.supporting_patterns),
      e.created_at,
    );
  } catch (err: any) {
    logger.warn('Failed to persist recommendation explanation', { id: e.id, error: err.message });
  }
}

async function _persistLearningExplanation(e: LearningExplanation): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO v3_learning_explanations
         (id, business_id, update_source_type, update_source_id,
          updated_weights, updated_preferences, rejected_patterns_added,
          confidence_changes, reasoning_summary, significance, is_short_term, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      e.id, e.business_id, e.update_source_type, e.update_source_id,
      JSON.stringify(e.updated_weights),
      JSON.stringify(e.updated_preferences),
      JSON.stringify(e.rejected_patterns_added),
      JSON.stringify(e.confidence_changes),
      e.reasoning_summary,
      e.significance,
      e.is_short_term,
      e.created_at,
    );
  } catch (err: any) {
    logger.warn('Failed to persist learning explanation', { id: e.id, error: err.message });
  }
}

// ─── Deserializers ────────────────────────────────────────────────────────────

function _deserializeInsightExplanation(row: any): InsightExplanation {
  return {
    ...row,
    contributing_signals:   _parseJson(row.contributing_signals, []),
    contributing_events:    _parseJson(row.contributing_events, []),
    contributing_forecasts: _parseJson(row.contributing_forecasts, []),
    top_factors:            _parseJson(row.top_factors, []),
    confidence_breakdown:   _parseJson(row.confidence_breakdown, {}),
  };
}

function _deserializeDecisionExplanation(row: any): DecisionExplanation {
  return {
    ...row,
    rejected_action_types:  _parseJson(row.rejected_action_types, []),
    score_breakdown:        _parseJson(row.score_breakdown, {}),
    policy_checks_passed:   _parseJson(row.policy_checks_passed, []),
    policy_checks_failed:   _parseJson(row.policy_checks_failed, []),
    memory_factors_used:    _parseJson(row.memory_factors_used, []),
  };
}

function _parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; }
  catch { return fallback; }
}
