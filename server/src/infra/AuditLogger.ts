/**
 * AuditLogger — write-once audit trail for all consequential system actions.
 *
 * Mandatory audit events:
 * - every decision created
 * - every policy rejection / eligibility failure
 * - every approval / rejection action
 * - every execution dispatch
 * - every execution failure
 * - every weight update above significance threshold
 * - every manual override
 * - every forbidden state transition attempt
 *
 * Tenant safety: business_id is always required.
 * actor_type distinguishes system, user, and agent actors.
 */

import { nanoid } from 'nanoid';
import { prisma } from '../db';
import { createLogger } from './logger';

const logger = createLogger('AuditLogger');

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActorType = 'system' | 'user' | 'agent';

export interface AuditEntry {
  id?:          string;
  business_id:  string;
  tenant_id?:   string;
  actor_type:   ActorType;
  actor_id:     string;           // userId, agentName, or 'system'
  entity_type:  string;           // 'decision' | 'opportunity' | 'recommendation' | 'execution_task' | 'weight' | ...
  entity_id:    string;
  action:       string;           // 'created' | 'state_transition' | 'approved' | 'rejected' | 'dispatched' | 'failed' | 'overridden' | 'forbidden_transition'
  old_state?:   string;
  new_state?:   string;
  reason?:      string;
  metadata?:    Record<string, unknown>;
  created_at?:  string;
}

export type SignificanceLevel = 'low' | 'medium' | 'high';

// ─── Write audit log ──────────────────────────────────────────────────────────

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const id         = entry.id ?? `aud_${nanoid(12)}`;
  const created_at = entry.created_at ?? new Date().toISOString();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO v3_audit_logs
         (id, business_id, tenant_id, actor_type, actor_id,
          entity_type, entity_id, action, old_state, new_state,
          reason, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      id,
      entry.business_id,
      entry.tenant_id ?? null,
      entry.actor_type,
      entry.actor_id,
      entry.entity_type,
      entry.entity_id,
      entry.action,
      entry.old_state ?? null,
      entry.new_state ?? null,
      entry.reason ?? null,
      JSON.stringify(entry.metadata ?? {}),
      created_at,
    );
  } catch (err: any) {
    // Audit must never crash the main flow — log locally and continue
    logger.error('Audit log write failed', { entity_id: entry.entity_id, error: err.message });
  }

  logger.debug('Audit written', {
    action:      entry.action,
    entity_type: entry.entity_type,
    entity_id:   entry.entity_id,
    business_id: entry.business_id,
  });
}

// ─── Shorthand helpers ────────────────────────────────────────────────────────

export async function auditDecisionCreated(
  businessId: string,
  decisionId: string,
  actionType: string,
  score: number,
  executionMode: string,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'system',
    actor_id:    'DecisionEngine',
    entity_type: 'decision',
    entity_id:   decisionId,
    action:      'created',
    new_state:   'created',
    reason:      `action_type=${actionType}, score=${score}, mode=${executionMode}`,
    metadata:    { action_type: actionType, score, execution_mode: executionMode },
  });
}

export async function auditPolicyRejection(
  businessId: string,
  entityId: string,
  entityType: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'system',
    actor_id:    'PolicyEngine',
    entity_type: entityType,
    entity_id:   entityId,
    action:      'policy_rejected',
    reason,
    metadata,
  });
}

export async function auditApprovalAction(
  businessId: string,
  approvalId: string,
  action: 'approved' | 'rejected' | 'expired',
  actorId: string,
  actorType: ActorType,
  notes?: string,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  actorType,
    actor_id:    actorId,
    entity_type: 'approval_request',
    entity_id:   approvalId,
    action,
    new_state:   action,
    reason:      notes,
  });
}

export async function auditExecutionDispatch(
  businessId: string,
  taskId: string,
  channel: string,
  success: boolean,
  error?: string,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'system',
    actor_id:    'ActionDispatcher',
    entity_type: 'execution_task',
    entity_id:   taskId,
    action:      success ? 'dispatched' : 'dispatch_failed',
    new_state:   success ? 'completed' : 'failed',
    reason:      error,
    metadata:    { channel },
  });
}

export async function auditWeightUpdate(
  businessId: string,
  agentName: string,
  actionType: string,
  oldWeight: number,
  newWeight: number,
  reason: string,
  significance: SignificanceLevel,
): Promise<void> {
  // Only audit medium/high significance weight changes
  if (significance === 'low') return;
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'system',
    actor_id:    'PolicyWeightUpdater',
    entity_type: 'policy_weight',
    entity_id:   `${businessId}:${agentName}:${actionType}`,
    action:      'weight_updated',
    old_state:   String(oldWeight),
    new_state:   String(newWeight),
    reason,
    metadata:    { agent_name: agentName, action_type: actionType, delta: newWeight - oldWeight, significance },
  });
}

export async function auditManualOverride(
  businessId: string,
  userId: string,
  entityType: string,
  entityId: string,
  overrideData: Record<string, unknown>,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'user',
    actor_id:    userId,
    entity_type: entityType,
    entity_id:   entityId,
    action:      'manual_override',
    reason:      'user manual override',
    metadata:    overrideData,
  });
}

export async function auditForbiddenTransition(
  businessId: string,
  entityType: string,
  entityId: string,
  fromState: string,
  toState: string,
  attemptedBy: string,
): Promise<void> {
  return writeAuditLog({
    business_id: businessId,
    actor_type:  'system',
    actor_id:    attemptedBy,
    entity_type: entityType,
    entity_id:   entityId,
    action:      'forbidden_transition_attempt',
    old_state:   fromState,
    new_state:   toState,
    reason:      `Forbidden: ${entityType} ${fromState} → ${toState}`,
    metadata:    { from_state: fromState, to_state: toState },
  });
}

/** Compute significance of a weight change */
export function weightSignificance(oldWeight: number, newWeight: number): SignificanceLevel {
  const delta = Math.abs(newWeight - oldWeight);
  if (delta >= 0.10) return 'high';
  if (delta >= 0.04) return 'medium';
  return 'low';
}
