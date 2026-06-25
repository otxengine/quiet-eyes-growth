/**
 * emailApproval.ts — one-click approve/reject via JWT link in email.
 * Routes: GET /api/actions/email-approve?token=xxx
 *         GET /api/actions/email-reject?token=xxx
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { dispatch, ActionType } from '../services/execution/executeOrQueue';
import { verifyApprovalToken } from '../lib/jwtToken';
import { FRONTEND_URL } from '../lib/email';

const router = Router();

router.get('/email-approve', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) return res.redirect(`${FRONTEND_URL}/approvals?email_result=invalid`);

  let actionId: string;
  let businessProfileId: string;

  try {
    ({ actionId, businessProfileId } = verifyApprovalToken(token));
  } catch {
    return res.redirect(`${FRONTEND_URL}/approvals?email_result=expired`);
  }

  try {
    const action = await prisma.autoAction.findFirst({
      where: { id: actionId, linked_business: businessProfileId },
    });

    if (!action) {
      return res.redirect(`${FRONTEND_URL}/approvals?email_result=not_found`);
    }

    if (action.status !== 'pending_approval') {
      return res.redirect(`${FRONTEND_URL}/approvals?email_result=already_handled&status=${action.status}`);
    }

    await prisma.autoAction.update({ where: { id: actionId }, data: { status: 'executing' } });

    let result = '';
    let finalStatus = 'completed';

    try {
      let payload: Record<string, any> = {};
      try { payload = JSON.parse(action.payload || '{}'); } catch {}

      result = await dispatch({
        businessProfileId: action.linked_business,
        agentName: action.agent_name,
        actionType: action.action_type as ActionType,
        description: action.description,
        payload,
      });
    } catch (execErr: any) {
      result = execErr.message;
      finalStatus = 'failed';
    }

    await prisma.autoAction.update({
      where: { id: actionId },
      data: { status: finalStatus, executed_at: new Date().toISOString(), result },
    });

    await prisma.outcomeLog.create({
      data: {
        linked_business: businessProfileId,
        action_type: action.action_type,
        was_accepted: true,
        outcome_description: finalStatus === 'completed' ? result : `failed: ${result}`,
        linked_action: actionId,
        created_at: new Date().toISOString(),
      },
    }).catch(() => {});

    return res.redirect(`${FRONTEND_URL}/approvals?email_result=${finalStatus}&action=${encodeURIComponent(action.description)}`);
  } catch (err: any) {
    return res.redirect(`${FRONTEND_URL}/approvals?email_result=error`);
  }
});

router.get('/email-reject', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) return res.redirect(`${FRONTEND_URL}/approvals?email_result=invalid`);

  let actionId: string;
  let businessProfileId: string;

  try {
    ({ actionId, businessProfileId } = verifyApprovalToken(token));
  } catch {
    return res.redirect(`${FRONTEND_URL}/approvals?email_result=expired`);
  }

  try {
    const action = await prisma.autoAction.findFirst({
      where: { id: actionId, linked_business: businessProfileId },
    });

    if (!action) {
      return res.redirect(`${FRONTEND_URL}/approvals?email_result=not_found`);
    }

    if (action.status !== 'pending_approval') {
      return res.redirect(`${FRONTEND_URL}/approvals?email_result=already_handled&status=${action.status}`);
    }

    await prisma.autoAction.update({ where: { id: actionId }, data: { status: 'rejected' } });

    await prisma.outcomeLog.create({
      data: {
        linked_business: businessProfileId,
        action_type: action.action_type,
        was_accepted: false,
        outcome_description: 'rejected_via_email',
        linked_action: actionId,
        created_at: new Date().toISOString(),
      },
    }).catch(() => {});

    return res.redirect(`${FRONTEND_URL}/approvals?email_result=rejected&action=${encodeURIComponent(action.description)}`);
  } catch (err: any) {
    return res.redirect(`${FRONTEND_URL}/approvals?email_result=error`);
  }
});

export default router;
