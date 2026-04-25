/**
 * executeOrQueue — central dispatch layer for all autonomous agent actions.
 *
 * Checks the business's autonomy_level and decides whether to:
 *   full_auto   → execute immediately, log AutoAction as 'completed'
 *   semi_auto   → create AutoAction as 'pending_approval' + schedule auto-exec after X hours
 *   manual      → create AutoAction as 'pending_approval' (no auto-exec)
 *
 * EXCEPTION: leads are ALWAYS manual regardless of autonomy_level.
 *
 * Every action creates an AutoAction record for the Dashboard ROI feed.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';
import { sendWhatsApp } from './WhatsAppExecutor';
import { postReviewReply } from './GoogleBusinessClient';
import { publishPost } from './InstagramPublisher';

const logger = createLogger('executeOrQueue');

export type ActionType =
  | 'review_reply'
  | 'whatsapp_send'
  | 'post_publish'
  | 'review_request';

export interface QueuedAction {
  businessProfileId: string;
  agentName: string;
  actionType: ActionType;
  description: string;             // human-readable, shown in Dashboard feed
  payload: Record<string, any>;    // action-specific data
  revenueImpact?: number;          // estimated ₪ impact (for ROI calc)
  autoExecuteAfterHours?: number;  // semi_auto: hours before auto-exec (default 24)
  isLead?: boolean;                // if true → always manual, never auto
}

export interface ExecuteResult {
  executed: boolean;
  autoActionId: string;
  method?: string;
}

export async function executeOrQueue(action: QueuedAction): Promise<ExecuteResult> {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: action.businessProfileId },
    select: { autonomy_level: true },
  });

  const autonomy = (profile?.autonomy_level ?? 'semi_auto') as string;

  // Leads stay manual regardless of autonomy level
  if (action.isLead) {
    const id = await createAutoAction(action, 'pending_approval', null);
    return { executed: false, autoActionId: id };
  }

  if (autonomy === 'full_auto') {
    const id = await createAutoAction(action, 'executing', null);
    try {
      const result = await dispatch(action);
      await prisma.autoAction.update({
        where: { id },
        data: { status: 'completed', executed_at: new Date().toISOString(), result },
      });
      logger.info(`Auto-executed: ${action.actionType}`, { businessProfileId: action.businessProfileId });
      return { executed: true, autoActionId: id, method: 'full_auto' };
    } catch (err: any) {
      await prisma.autoAction.update({
        where: { id },
        data: { status: 'failed', result: err.message },
      });
      throw err;
    }
  }

  if (autonomy === 'semi_auto') {
    const delayHours = action.autoExecuteAfterHours ?? 24;
    const autoAt = new Date(Date.now() + delayHours * 3_600_000).toISOString();
    const id = await createAutoAction(action, 'pending_approval', autoAt);
    logger.info(`Queued for semi-auto (${delayHours}h): ${action.actionType}`, { businessProfileId: action.businessProfileId });
    return { executed: false, autoActionId: id, method: 'semi_auto' };
  }

  // manual
  const id = await createAutoAction(action, 'pending_approval', null);
  return { executed: false, autoActionId: id, method: 'manual' };
}

/** Actually run the action via the appropriate executor */
export async function dispatch(action: QueuedAction): Promise<string> {
  const { actionType, businessProfileId, payload } = action;

  switch (actionType) {
    case 'review_reply': {
      const r = await postReviewReply(businessProfileId, {
        reviewId: payload.reviewId,
        replyText: payload.replyText,
        googleReviewId: payload.googleReviewId,
      });
      return r.published ? `פורסם ב-Google` : `נשמר כהצעה`;
    }

    case 'whatsapp_send':
    case 'review_request': {
      const r = await sendWhatsApp(businessProfileId, {
        to: payload.phone,
        text: payload.message,
        leadId: payload.leadId,
        customerName: payload.customerName,
      });
      return r.sent ? `נשלח בוואטסאפ` : `ממתין לשליחה ידנית`;
    }

    case 'post_publish': {
      const r = await publishPost(businessProfileId, {
        taskId: payload.taskId,
        caption: payload.caption,
        imageUrl: payload.imageUrl,
        platform: payload.platform,
      });
      return r.published
        ? `פורסם ב: ${r.platforms.join(', ')}`
        : `מוכן לפרסום — ממתין לאישור`;
    }

    default:
      return 'פעולה לא מוכרת';
  }
}

async function createAutoAction(
  action: QueuedAction,
  status: string,
  autoExecuteAt: string | null,
): Promise<string> {
  const record = await prisma.autoAction.create({
    data: {
      linked_business: action.businessProfileId,
      agent_name: action.agentName,
      action_type: action.actionType,
      description: action.description,
      payload: JSON.stringify(action.payload),
      revenue_impact: action.revenueImpact ?? 0,
      status,
      auto_execute_at: autoExecuteAt,
    },
  });
  return record.id;
}

/**
 * processScheduledAutoActions — called by the scheduler every 30 min.
 * Executes any pending_approval actions whose auto_execute_at has passed.
 */
export async function processScheduledAutoActions(): Promise<void> {
  const now = new Date().toISOString();
  const due = await prisma.autoAction.findMany({
    where: {
      status: 'pending_approval',
      auto_execute_at: { lte: now },
    },
    take: 20,
  });

  for (const action of due) {
    try {
      let payload: Record<string, any> = {};
      try { payload = JSON.parse(action.payload || '{}'); } catch {}

      await prisma.autoAction.update({ where: { id: action.id }, data: { status: 'executing' } });

      const result = await dispatch({
        businessProfileId: action.linked_business,
        agentName: action.agent_name,
        actionType: action.action_type as ActionType,
        description: action.description,
        payload,
      });

      await prisma.autoAction.update({
        where: { id: action.id },
        data: { status: 'completed', executed_at: new Date().toISOString(), result },
      });

      logger.info('Scheduled auto-action executed', { id: action.id, type: action.action_type });
    } catch (err: any) {
      await prisma.autoAction.update({
        where: { id: action.id },
        data: { status: 'failed', result: err.message },
      });
      logger.error('Scheduled auto-action failed', { id: action.id, error: err.message });
    }
  }
}
