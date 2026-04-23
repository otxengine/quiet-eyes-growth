/**
 * ApprovalWorkflow — explicit approval request subsystem.
 *
 * ApprovalRequest lifecycle:
 *   created → pending → approved | rejected | expired
 *
 * Rules:
 * - rejected approval propagates state back to decision (rejected) + execution (canceled)
 * - approved request emits execution.approval_required resolution event
 * - approval timeout expires the request and cancels execution
 * - all approval actions are audited
 */

import { nanoid }     from 'nanoid';
import { prisma }     from '../../db';
import { bus }        from '../../events/EventBus';
import { createLogger } from '../../infra/logger';
import {
  auditApprovalAction,
  auditPolicyRejection,
} from '../../infra/AuditLogger';
import {
  assertTransitionWithAudit,
  DECISION_TRANSITIONS,
  TASK_TRANSITIONS,
} from '../../state/StateMachines';

const logger = createLogger('ApprovalWorkflow');

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalType   = 'execution' | 'recommendation' | 'override';
export type ActorType      = 'user' | 'system' | 'agent';

export interface ApprovalRequest {
  id:                string;
  business_id:       string;
  tenant_id:         string | null;
  decision_id:       string;
  recommendation_id: string | null;
  execution_task_id: string | null;
  approval_type:     ApprovalType;
  requested_by:      string;          // actor_id (system/agent/user)
  requested_at:      string;          // ISO 8601
  expires_at:        string | null;   // null = no timeout
  status:            ApprovalStatus;
  resolved_by:       string | null;
  resolved_at:       string | null;
  notes:             string | null;
}

export interface ApprovalResult {
  request:    ApprovalRequest;
  propagated: boolean;
  message:    string;
}

// Default approval timeout (hours) — override via ConfigResolver
const DEFAULT_APPROVAL_TIMEOUT_HOURS = 24;

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createApprovalRequest(params: {
  businessId:       string;
  tenantId?:        string;
  decisionId:       string;
  recommendationId?: string;
  executionTaskId?:  string;
  approvalType:      ApprovalType;
  requestedBy:       string;
  timeoutHours?:     number;
  notes?:            string;
}): Promise<ApprovalRequest> {
  const id          = `apr_${nanoid(12)}`;
  const now         = new Date().toISOString();
  const timeoutH    = params.timeoutHours ?? DEFAULT_APPROVAL_TIMEOUT_HOURS;
  const expires_at  = new Date(Date.now() + timeoutH * 3_600_000).toISOString();

  const request: ApprovalRequest = {
    id,
    business_id:       params.businessId,
    tenant_id:         params.tenantId ?? null,
    decision_id:       params.decisionId,
    recommendation_id: params.recommendationId ?? null,
    execution_task_id: params.executionTaskId  ?? null,
    approval_type:     params.approvalType,
    requested_by:      params.requestedBy,
    requested_at:      now,
    expires_at,
    status:            'pending',
    resolved_by:       null,
    resolved_at:       null,
    notes:             params.notes ?? null,
  };

  await prisma.$executeRawUnsafe(
    `INSERT INTO v3_approval_requests
       (id, business_id, tenant_id, decision_id, recommendation_id,
        execution_task_id, approval_type, requested_by, requested_at,
        expires_at, status, resolved_by, resolved_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    id,
    params.businessId,
    params.tenantId   ?? null,
    params.decisionId,
    params.recommendationId ?? null,
    params.executionTaskId  ?? null,
    params.approvalType,
    params.requestedBy,
    now,
    expires_at,
    'pending',
    null,
    null,
    params.notes ?? null,
  );

  logger.info('Approval request created', { id, decision_id: params.decisionId, expires_at });
  return request;
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function getApprovalRequest(
  id: string,
  businessId: string,
): Promise<ApprovalRequest | null> {
  const rows = await prisma.$queryRawUnsafe<ApprovalRequest[]>(
    `SELECT * FROM v3_approval_requests WHERE id = $1 AND business_id = $2 LIMIT 1`,
    id,
    businessId,
  );
  return rows[0] ?? null;
}

export async function getPendingApprovals(businessId: string): Promise<ApprovalRequest[]> {
  return prisma.$queryRawUnsafe<ApprovalRequest[]>(
    `SELECT * FROM v3_approval_requests
     WHERE business_id = $1 AND status = 'pending'
     ORDER BY requested_at ASC`,
    businessId,
  );
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveRequest(
  id: string,
  businessId: string,
  resolvedBy: string,
  actorType: ActorType = 'user',
  notes?: string,
): Promise<ApprovalResult> {
  const request = await getApprovalRequest(id, businessId);
  if (!request) throw new Error(`Approval request ${id} not found`);

  _assertPending(request);
  _assertNotExpired(request);

  const now = new Date().toISOString();
  await _resolveRequest(id, 'approved', resolvedBy, now, notes ?? null);

  // Propagate: transition execution task created → dispatched path
  if (request.execution_task_id) {
    await _transitionTask(request.execution_task_id, 'awaiting_approval', 'approved', businessId);
  }

  await auditApprovalAction(businessId, id, 'approved', resolvedBy, actorType, notes);

  // Emit event so ActionDispatcher can resume dispatch
  await bus.emit(bus.makeEvent(
    'action.dispatched',
    businessId,
    {
      task_id:     request.execution_task_id ?? '',
      decision_id: request.decision_id,
      business_id: businessId,
      task_type:   'approved',
      channel:     'approval',
    },
  ));

  logger.info('Approval request approved', { id, resolved_by: resolvedBy });
  return {
    request: { ...request, status: 'approved', resolved_by: resolvedBy, resolved_at: now, notes: notes ?? null },
    propagated: true,
    message: 'Approved. Execution task resumed.',
  };
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectRequest(
  id: string,
  businessId: string,
  resolvedBy: string,
  actorType: ActorType = 'user',
  notes?: string,
): Promise<ApprovalResult> {
  const request = await getApprovalRequest(id, businessId);
  if (!request) throw new Error(`Approval request ${id} not found`);

  _assertPending(request);

  const now = new Date().toISOString();
  await _resolveRequest(id, 'rejected', resolvedBy, now, notes ?? null);

  // Propagate: decision → rejected, execution task → canceled
  await _transitionDecision(request.decision_id, 'recommended', 'rejected', businessId);
  if (request.execution_task_id) {
    await _transitionTask(request.execution_task_id, 'awaiting_approval', 'canceled', businessId);
  }

  await auditApprovalAction(businessId, id, 'rejected', resolvedBy, actorType, notes);
  await auditPolicyRejection(businessId, request.decision_id, 'decision',
    `Approval rejected by ${resolvedBy}: ${notes ?? 'no reason given'}`);

  logger.info('Approval request rejected', { id, resolved_by: resolvedBy });
  return {
    request: { ...request, status: 'rejected', resolved_by: resolvedBy, resolved_at: now, notes: notes ?? null },
    propagated: true,
    message: 'Rejected. Decision and execution task updated.',
  };
}

// ─── Expire stale approvals ───────────────────────────────────────────────────

/**
 * Expire all pending approval requests past their `expires_at` deadline.
 * Safe to call repeatedly (idempotent).
 */
export async function expireStaleApprovals(businessId: string): Promise<number> {
  const pending = await getPendingApprovals(businessId);
  const now     = Date.now();
  let expired   = 0;

  for (const req of pending) {
    if (!req.expires_at) continue;
    if (new Date(req.expires_at).getTime() > now) continue;

    const resolvedAt = new Date().toISOString();
    await _resolveRequest(req.id, 'expired', 'system', resolvedAt, 'Approval timeout exceeded');

    // Cancel execution task
    if (req.execution_task_id) {
      await _transitionTask(req.execution_task_id, 'awaiting_approval', 'canceled', businessId).catch(() => {});
    }

    await auditApprovalAction(businessId, req.id, 'expired', 'system', 'system', 'Timeout');

    logger.warn('Approval request expired', { id: req.id, decision_id: req.decision_id });
    expired++;
  }

  return expired;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _assertPending(req: ApprovalRequest): void {
  if (req.status !== 'pending') {
    throw new Error(`Approval request ${req.id} is already ${req.status} — cannot modify`);
  }
}

function _assertNotExpired(req: ApprovalRequest): void {
  if (req.expires_at && new Date(req.expires_at).getTime() < Date.now()) {
    throw new Error(`Approval request ${req.id} has expired`);
  }
}

async function _resolveRequest(
  id: string,
  status: ApprovalStatus,
  resolvedBy: string,
  resolvedAt: string,
  notes: string | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE v3_approval_requests
     SET status = $1, resolved_by = $2, resolved_at = $3::timestamptz, notes = $4
     WHERE id = $5`,
    status, resolvedBy, resolvedAt, notes, id,
  );
}

async function _transitionDecision(
  decisionId: string,
  from: string,
  to: string,
  businessId: string,
): Promise<void> {
  try {
    await assertTransitionWithAudit(
      DECISION_TRANSITIONS, 'decision', decisionId, businessId, from, to, 'ApprovalWorkflow',
    );
    await prisma.$executeRawUnsafe(
      `UPDATE v3_decisions SET status = $1, updated_at = now() WHERE id = $2`,
      to, decisionId,
    );
  } catch (err: any) {
    logger.warn('Could not propagate decision state', { decisionId, from, to, error: err.message });
  }
}

async function _transitionTask(
  taskId: string,
  from: string,
  to: string,
  businessId: string,
): Promise<void> {
  try {
    await assertTransitionWithAudit(
      TASK_TRANSITIONS, 'task', taskId, businessId, from, to, 'ApprovalWorkflow',
    );
    await prisma.$executeRawUnsafe(
      `UPDATE v3_execution_tasks SET status = $1, updated_at = now() WHERE id = $2`,
      to, taskId,
    );
  } catch (err: any) {
    logger.warn('Could not propagate task state', { taskId, from, to, error: err.message });
  }
}
