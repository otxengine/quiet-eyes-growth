/**
 * OTXEngine State Machines — v2
 *
 * Defines valid states, allowed transitions, and EXPLICITLY FORBIDDEN
 * transitions for all core entities.
 *
 * Usage:
 *   canTransition(DECISION_TRANSITIONS, from, to)      → boolean (check only)
 *   assertTransition(machine, entityType, from, to)     → throws on forbidden
 *   assertTransitionWithAudit(...)                      → throws + writes audit log
 *
 * Audit is written on every forbidden transition attempt.
 * Forbidden transitions are explicitly listed for documentation and enforcement.
 */

// ─── Opportunity ──────────────────────────────────────────────────────────────

export const OPPORTUNITY_STATES = [
  'detected', 'qualified', 'fused', 'decided',
  'recommended', 'expired', 'archived',
] as const;
export type OpportunityState = typeof OPPORTUNITY_STATES[number];

export const OPPORTUNITY_TRANSITIONS: Record<OpportunityState, OpportunityState[]> = {
  detected:    ['qualified', 'expired'],
  qualified:   ['fused', 'expired', 'archived'],
  fused:       ['decided', 'archived', 'expired'],
  decided:     ['recommended', 'expired'],
  recommended: ['expired', 'archived'],
  expired:     ['archived'],
  archived:    [],
};

/** Explicitly forbidden transitions — documented for policy compliance */
export const OPPORTUNITY_FORBIDDEN: Array<[OpportunityState, OpportunityState]> = [
  ['detected',  'decided'],        // must go through qualified and fused
  ['detected',  'recommended'],    // must go through full pipeline
  ['expired',   'recommended'],    // cannot resurface after expiry
  ['archived',  'detected'],       // archives are final
  ['archived',  'active' as any],  // archives are final
];

// ─── Threat ───────────────────────────────────────────────────────────────────

export const THREAT_STATES = [
  'detected', 'active', 'mitigated', 'expired', 'archived',
] as const;
export type ThreatState = typeof THREAT_STATES[number];

export const THREAT_TRANSITIONS: Record<ThreatState, ThreatState[]> = {
  detected:  ['active', 'expired', 'archived'],
  active:    ['mitigated', 'expired'],
  mitigated: ['archived'],
  expired:   ['archived'],
  archived:  [],
};

// ─── Decision ─────────────────────────────────────────────────────────────────

export const DECISION_STATES = [
  'created', 'scored', 'recommended', 'awaiting_approval',
  'approved', 'rejected', 'executed', 'measured', 'learned',
] as const;
export type DecisionState = typeof DECISION_STATES[number];

export const DECISION_TRANSITIONS: Record<DecisionState, DecisionState[]> = {
  created:           ['scored'],
  scored:            ['recommended'],
  recommended:       ['awaiting_approval', 'approved', 'rejected'],
  awaiting_approval: ['approved', 'rejected'],
  approved:          ['executed'],
  rejected:          ['learned'],
  executed:          ['measured'],
  measured:          ['learned'],
  learned:           [],
};

export const DECISION_FORBIDDEN: Array<[DecisionState, DecisionState]> = [
  ['created',  'executed'],         // must score and recommend first
  ['created',  'approved'],         // must go through scoring
  ['rejected', 'executed'],         // rejected decisions cannot execute
  ['rejected', 'approved'],         // rejected cannot be approved
  ['learned',  'approved'],         // terminal state
  ['learned',  'executed'],         // terminal state
  ['executed', 'rejected'],         // cannot reject after execution
];

// ─── ExecutionTask ────────────────────────────────────────────────────────────

export const TASK_STATES = [
  'created', 'queued', 'prepared', 'awaiting_approval',
  'approved', 'dispatched', 'failed', 'completed', 'canceled',
] as const;
export type TaskState = typeof TASK_STATES[number];

export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  created:           ['queued', 'canceled'],
  queued:            ['prepared', 'canceled'],
  prepared:          ['awaiting_approval', 'approved', 'dispatched'],
  awaiting_approval: ['approved', 'canceled'],
  approved:          ['dispatched'],
  dispatched:        ['completed', 'failed'],
  failed:            ['queued', 'canceled'],        // retry: back to queued
  completed:         [],
  canceled:          [],
};

export const TASK_FORBIDDEN: Array<[TaskState, TaskState]> = [
  ['created',   'completed'],       // must go through full flow
  ['created',   'dispatched'],      // must queue and prepare first
  ['canceled',  'dispatched'],      // canceled tasks cannot dispatch
  ['canceled',  'completed'],       // canceled is terminal
  ['completed', 'failed'],          // completed is terminal
  ['failed',    'completed'],       // cannot complete without retry through queued
];

// ─── Learning Cycle ───────────────────────────────────────────────────────────

export const LEARNING_STATES = [
  'feedback_captured', 'outcome_captured', 'memory_updated',
  'weights_updated', 'policy_recalibrated',
] as const;
export type LearningState = typeof LEARNING_STATES[number];

export const LEARNING_TRANSITIONS: Record<LearningState, LearningState[]> = {
  feedback_captured:   ['memory_updated'],              // must update memory first
  outcome_captured:    ['memory_updated'],              // must update memory first
  memory_updated:      ['weights_updated'],
  weights_updated:     ['policy_recalibrated'],
  policy_recalibrated: [],
};

export const LEARNING_FORBIDDEN: Array<[LearningState, LearningState]> = [
  ['feedback_captured',   'policy_recalibrated'],  // cannot skip memory + weights
  ['feedback_captured',   'weights_updated'],       // memory must come first
  ['outcome_captured',    'policy_recalibrated'],  // cannot skip intermediate steps
  ['weights_updated',     'feedback_captured'],     // no backward loop
  ['policy_recalibrated', 'feedback_captured'],    // no backward loop
];

// ─── Guard functions ──────────────────────────────────────────────────────────

/**
 * Check whether a state transition is valid.
 */
export function canTransition(
  machine: Record<string, string[]>,
  from: string,
  to: string,
): boolean {
  return (machine[from] ?? []).includes(to);
}

/**
 * Check if a transition is in the explicit forbidden list.
 */
export function isForbidden(
  forbiddenList: Array<[string, string]>,
  from: string,
  to: string,
): boolean {
  return forbiddenList.some(([f, t]) => f === from && t === to);
}

/**
 * Assert transition is valid. Throws with clear message if not.
 */
export function assertTransition(
  machine: Record<string, string[]>,
  entityType: string,
  from: string,
  to: string,
): void {
  if (!canTransition(machine, from, to)) {
    throw new Error(
      `Invalid ${entityType} state transition: ${from} → ${to}. ` +
      `Allowed from '${from}': [${(machine[from] ?? []).join(', ')}]`,
    );
  }
}

/**
 * Assert transition is valid AND write audit log on forbidden attempt.
 * This is the preferred guard for production code paths.
 */
export async function assertTransitionWithAudit(
  machine: Record<string, string[]>,
  entityType: string,
  entityId: string,
  businessId: string,
  from: string,
  to: string,
  attemptedBy = 'system',
): Promise<void> {
  if (!canTransition(machine, from, to)) {
    // Write audit log asynchronously (do not await to avoid blocking)
    import('../infra/AuditLogger').then(({ auditForbiddenTransition }) => {
      auditForbiddenTransition(businessId, entityType, entityId, from, to, attemptedBy)
        .catch(() => {}); // audit must never crash main flow
    }).catch(() => {});

    throw new Error(
      `Forbidden ${entityType} state transition: ${from} → ${to}. ` +
      `Entity: ${entityId}. Allowed from '${from}': [${(machine[from] ?? []).join(', ')}]`,
    );
  }
}

// ─── State machine registry ───────────────────────────────────────────────────

export const STATE_MACHINES = {
  opportunity: OPPORTUNITY_TRANSITIONS,
  threat:      THREAT_TRANSITIONS,
  decision:    DECISION_TRANSITIONS,
  task:        TASK_TRANSITIONS,
  learning:    LEARNING_TRANSITIONS,
} as const;

export type EntityType = keyof typeof STATE_MACHINES;
