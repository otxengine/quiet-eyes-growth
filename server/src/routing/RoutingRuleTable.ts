/**
 * RoutingRuleTable — event-driven agent activation rules.
 *
 * Patent alignment: "A dynamic routing engine evaluates logical conditions
 * defined in a rule table at runtime and selectively activates relevant agents."
 *
 * Each rule maps: trigger event + conditions → pipeline stages to execute.
 * MasterOrchestrator receives the resolved stage set and skips everything else.
 *
 * ALL_STAGES (in pipeline order):
 *   context → classify → opportunities → engine_analysis →
 *   predict → fuse → decide → recommend → dispatch → learn
 *
 * Rule evaluation: rules are sorted by priority DESC, first matching rule wins.
 * A condition field path uses dot notation on the event payload (e.g. "risk_score").
 */

import { OTXEventType } from '../events/contracts';
import { PipelineStage }  from '../models';

// ─── Condition types ──────────────────────────────────────────────────────────

export type ConditionOperator = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'in' | 'not_in' | 'exists';

export interface RuleCondition {
  field:    string;              // dot-path into event.payload
  operator: ConditionOperator;
  value:    string | number | boolean | string[];
}

// ─── Rule definition ──────────────────────────────────────────────────────────

export interface RoutingRule {
  id:            string;
  name:          string;
  description:   string;
  trigger:       OTXEventType;
  conditions:    RuleCondition[];   // ALL must pass (AND semantics)
  stages_to_run: PipelineStage[];   // only these stages execute
  mode:          'partial' | 'full';
  priority:      number;            // higher = evaluated first
  enabled:       boolean;
}

// ─── Rule Table ───────────────────────────────────────────────────────────────

export const ROUTING_RULES: RoutingRule[] = [

  // ── Competitor change: high severity ─────────────────────────────────────
  {
    id:          'competitor_change_high',
    name:        'Competitor high-severity change',
    description: 'When a high-severity competitor change is detected, run threat + decision pipeline.',
    trigger:     'competitor.change.detected',
    conditions:  [{ field: 'severity', operator: '==', value: 'high' }],
    stages_to_run: ['classify', 'opportunities', 'fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    100,
    enabled:     true,
  },

  // ── Competitor change: medium/low severity ────────────────────────────────
  {
    id:          'competitor_change_low',
    name:        'Competitor medium/low change',
    description: 'Lower-severity competitor updates feed opportunities only, no full dispatch.',
    trigger:     'competitor.change.detected',
    conditions:  [],
    stages_to_run: ['classify', 'opportunities', 'fuse', 'decide', 'recommend'],
    mode:        'partial',
    priority:    90,
    enabled:     true,
  },

  // ── High-relevance signal → opportunity pipeline ──────────────────────────
  {
    id:          'signal_high_relevance',
    name:        'High-relevance signal',
    description: 'Signals with relevance ≥ 0.6 and urgency ≥ 0.5 trigger the full decide+dispatch chain.',
    trigger:     'signal.classified',
    conditions:  [
      { field: 'relevance_score', operator: '>=', value: 0.6 },
      { field: 'urgency_score',   operator: '>=', value: 0.5 },
    ],
    stages_to_run: ['opportunities', 'engine_analysis', 'fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    80,
    enabled:     true,
  },

  // ── Signal classified with moderate relevance ─────────────────────────────
  {
    id:          'signal_moderate_relevance',
    name:        'Moderate-relevance signal',
    description: 'Signals with relevance ≥ 0.3 go through opportunity detection and fusion only.',
    trigger:     'signal.classified',
    conditions:  [{ field: 'relevance_score', operator: '>=', value: 0.3 }],
    stages_to_run: ['opportunities', 'fuse', 'decide', 'recommend'],
    mode:        'partial',
    priority:    70,
    enabled:     true,
  },

  // ── High-risk threat → immediate dispatch ─────────────────────────────────
  {
    id:          'threat_high_risk',
    name:        'High-risk threat — immediate response',
    description: 'Threats with risk_score ≥ 0.7 skip straight to decide + dispatch.',
    trigger:     'threat.detected',
    conditions:  [
      { field: 'risk_score', operator: '>=', value: 0.7 },
      { field: 'is_new',     operator: '==', value: true },
    ],
    stages_to_run: ['fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    110,
    enabled:     true,
  },

  // ── Threat detected (any) ─────────────────────────────────────────────────
  {
    id:          'threat_any',
    name:        'Any new threat',
    description: 'All new threats feed the decision engine without full dispatch.',
    trigger:     'threat.detected',
    conditions:  [{ field: 'is_new', operator: '==', value: true }],
    stages_to_run: ['opportunities', 'fuse', 'decide', 'recommend'],
    mode:        'partial',
    priority:    95,
    enabled:     true,
  },

  // ── Demand spike → predict + dispatch ────────────────────────────────────
  {
    id:          'demand_spike',
    name:        'Demand spike detected',
    description: 'Demand spikes trigger forecasting, fusion and immediate dispatch.',
    trigger:     'demand.spike.detected',
    conditions:  [{ field: 'spike_factor', operator: '>=', value: 1.5 }],
    stages_to_run: ['predict', 'fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    85,
    enabled:     true,
  },

  // ── Forecast update: high confidence ─────────────────────────────────────
  {
    id:          'forecast_high_confidence',
    name:        'High-confidence forecast update',
    description: 'Confident demand forecasts re-trigger the decide → dispatch chain.',
    trigger:     'forecast.updated',
    conditions:  [
      { field: 'confidence',            operator: '>=', value: 0.55 },
      { field: 'expected_demand_score', operator: '>=', value: 0.4  },
    ],
    stages_to_run: ['fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    75,
    enabled:     true,
  },

  // ── Critical insight fused → fast-track dispatch ──────────────────────────
  {
    id:          'insight_fused_critical',
    name:        'Critical fused insight',
    description: 'Critical-urgency fused insights bypass normal pipeline and go directly to dispatch.',
    trigger:     'insight.fused',
    conditions:  [
      { field: 'urgency',    operator: '==', value: 'critical' },
      { field: 'confidence', operator: '>=', value: 0.5 },
    ],
    stages_to_run: ['decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    120,
    enabled:     true,
  },

  // ── Execution feedback → learning ─────────────────────────────────────────
  {
    id:          'execution_completed_learn',
    name:        'Execution completed — trigger learning',
    description: 'Every completed execution feeds back into the learning cycle.',
    trigger:     'execution.completed',
    conditions:  [],
    stages_to_run: ['learn'],
    mode:        'partial',
    priority:    60,
    enabled:     true,
  },

  // ── Churn risk → retention pipeline ──────────────────────────────────────
  {
    id:          'churn_risk_high',
    name:        'High churn risk',
    description: 'High churn risk triggers retention-focused decide + dispatch.',
    trigger:     'churn.risk.detected',
    conditions:  [{ field: 'risk_level', operator: '==', value: 'high' }],
    stages_to_run: ['engine_analysis', 'fuse', 'decide', 'recommend', 'dispatch'],
    mode:        'partial',
    priority:    88,
    enabled:     true,
  },
];

// ─── Condition evaluator ──────────────────────────────────────────────────────

function getField(payload: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) =>
    obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
  payload);
}

function evalCondition(payload: Record<string, unknown>, cond: RuleCondition): boolean {
  const val = getField(payload, cond.field);
  if (cond.operator === 'exists') return val !== undefined && val !== null;
  if (val === undefined || val === null) return false;

  switch (cond.operator) {
    case '>':    return Number(val) >  Number(cond.value);
    case '<':    return Number(val) <  Number(cond.value);
    case '>=':   return Number(val) >= Number(cond.value);
    case '<=':   return Number(val) <= Number(cond.value);
    case '==':   return val === cond.value;
    case '!=':   return val !== cond.value;
    case 'in':   return Array.isArray(cond.value) && cond.value.includes(val as string);
    case 'not_in': return Array.isArray(cond.value) && !cond.value.includes(val as string);
    default:     return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RouteResolution {
  rule:          RoutingRule;
  stages_to_run: PipelineStage[];
  stages_to_skip: PipelineStage[];
}

const ALL_STAGES: PipelineStage[] = [
  'context', 'classify', 'opportunities', 'engine_analysis',
  'predict', 'fuse', 'decide', 'recommend', 'dispatch', 'learn',
];

/**
 * Evaluate the rule table for a given event and return the first matching resolution.
 * Returns null if no rule matches (caller should fall back to full pipeline or skip).
 */
export function resolveRoute(
  eventType: OTXEventType,
  payload: Record<string, unknown>,
): RouteResolution | null {
  const candidates = ROUTING_RULES
    .filter(r => r.enabled && r.trigger === eventType)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of candidates) {
    const allPass = rule.conditions.every(cond => evalCondition(payload, cond));
    if (allPass) {
      const stageSet = new Set(rule.stages_to_run);
      return {
        rule,
        stages_to_run:  rule.stages_to_run,
        stages_to_skip: ALL_STAGES.filter(s => !stageSet.has(s)),
      };
    }
  }
  return null;
}

/**
 * Return all rules registered for a given trigger (for introspection/UI).
 */
export function getRulesForTrigger(eventType: OTXEventType): RoutingRule[] {
  return ROUTING_RULES.filter(r => r.enabled && r.trigger === eventType);
}
