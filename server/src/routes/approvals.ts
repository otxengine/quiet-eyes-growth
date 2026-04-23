/**
 * Approvals API
 *
 * POST /api/approvals                      — create approval request
 * GET  /api/approvals/:businessId          — list pending approvals
 * PUT  /api/approvals/:id/approve          — approve a request
 * PUT  /api/approvals/:id/reject           — reject a request
 * POST /api/approvals/expire/:businessId   — expire stale approvals
 */

import { Router, Request, Response } from 'express';
import {
  createApprovalRequest,
  approveRequest,
  rejectRequest,
  expireStaleApprovals,
  getPendingApprovals,
} from '../services/approval/ApprovalWorkflow';
import { createLogger } from '../infra/logger';

const logger = createLogger('ApprovalsRoute');
const router = Router();

// ─── POST /api/approvals ──────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { businessId, decisionId, recommendationId, executionTaskId, approvalType, requestedBy, timeoutHours } = req.body;

  if (!businessId || !decisionId || !approvalType || !requestedBy) {
    return res.status(400).json({ error: 'businessId, decisionId, approvalType, requestedBy required' });
  }

  if (!['execution', 'recommendation', 'override'].includes(approvalType)) {
    return res.status(400).json({ error: 'approvalType must be execution | recommendation | override' });
  }

  try {
    const request = await createApprovalRequest({
      businessId, decisionId, recommendationId, executionTaskId,
      approvalType, requestedBy,
      timeoutHours: timeoutHours ?? 24,
    });
    return res.status(201).json(request);
  } catch (err: any) {
    logger.error('Create approval failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/approvals/:businessId ──────────────────────────────────────────

router.get('/:businessId', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);

  try {
    const pending = await getPendingApprovals(businessId);
    return res.json({ business_id: businessId, pending, count: pending.length });
  } catch (err: any) {
    logger.error('List approvals failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/approvals/:id/approve ──────────────────────────────────────────

router.put('/:id/approve', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { businessId, resolvedBy, actorType, notes } = req.body;

  if (!businessId || !resolvedBy) {
    return res.status(400).json({ error: 'businessId and resolvedBy required' });
  }

  try {
    const result = await approveRequest(id, businessId, resolvedBy, actorType ?? 'user', notes);
    return res.json(result);
  } catch (err: any) {
    logger.error('Approve request failed', { id, error: err.message });
    const status = err.message.includes('not found') ? 404
                 : err.message.includes('already') ? 409 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// ─── PUT /api/approvals/:id/reject ────────────────────────────────────────────

router.put('/:id/reject', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { businessId, resolvedBy, actorType, notes } = req.body;

  if (!businessId || !resolvedBy) {
    return res.status(400).json({ error: 'businessId and resolvedBy required' });
  }

  try {
    const result = await rejectRequest(id, businessId, resolvedBy, actorType ?? 'user', notes);
    return res.json(result);
  } catch (err: any) {
    logger.error('Reject request failed', { id, error: err.message });
    const status = err.message.includes('not found') ? 404
                 : err.message.includes('already') ? 409 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// ─── POST /api/approvals/expire/:businessId ───────────────────────────────────

router.post('/expire/:businessId', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId);

  try {
    const count = await expireStaleApprovals(businessId);
    return res.json({ expired: count });
  } catch (err: any) {
    logger.error('Expire approvals failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
