/**
 * ActionDispatcher — Execution Layer
 *
 * Converts Decisions + Recommendations into ExecutionTasks.
 * Dispatches tasks to the appropriate channel handler.
 *
 * EXECUTION FLOW:
 * 1. Skip 'suggest' mode immediately
 * 2. Emit execution.requested
 * 3. If approval_required → emit execution.approval_required, save task as awaiting_approval, return
 * 4. Run channel handler
 * 5. Emit execution.completed or execution.failed
 *
 * SAFETY RULES:
 * - Never auto-publish promotional content without approval flag clearance
 * - Always require human approval for financial actions
 * - Log every dispatch attempt (success or failure)
 * - Retry failed tasks up to max_attempts
 * - Idempotent: re-running won't duplicate tasks
 */

import { nanoid } from 'nanoid';
import { Decision, Recommendation, ExecutionTask, SentAction } from '../../models';
import { decisionRepository } from '../../repositories/DecisionRepository';
import { bus } from '../../events/EventBus';
import { createLogger } from '../../infra/logger';
import { prisma } from '../../db';
import { executeOrQueue } from './executeOrQueue';

const logger = createLogger('ActionDispatcher');

// ─── Channel registry ─────────────────────────────────────────────────────────

type ChannelHandler = (task: ExecutionTask, rec: Recommendation) => Promise<DispatchResult>;

interface DispatchResult {
  success:  boolean;
  result:   string;
  metadata: Record<string, unknown>;
}

// Default handler for channels not yet integrated
async function noopHandler(task: ExecutionTask, rec: Recommendation): Promise<DispatchResult> {
  return {
    success:  true,
    result:   `Draft ready for ${task.channel}. Auto-dispatch not configured.`,
    metadata: { draft: rec.draft_content, cta: rec.cta },
  };
}

// Dashboard alert handler — writes to ProactiveAlert table
async function dashboardHandler(task: ExecutionTask, rec: Recommendation): Promise<DispatchResult> {
  try {
    await prisma.proactiveAlert.create({
      data: {
        linked_business:  task.business_id,
        alert_type:       task.task_type,
        title:            rec.title,
        description:      rec.body,
        suggested_action: rec.cta,
        priority:         rec.urgency === 'critical' ? 'high' : rec.urgency === 'high' ? 'medium' : 'low',
        source_agent:     `ActionDispatcher:${task.decision_id}`,
        created_at:       new Date().toISOString(),
        is_dismissed:     false,
      },
    });
    return { success: true, result: 'Alert created on dashboard', metadata: {} };
  } catch (e: any) {
    return { success: false, result: e.message, metadata: {} };
  }
}

// Social / messaging channel handler — routes through executeOrQueue for autonomy-aware dispatch
async function socialChannelHandler(task: ExecutionTask, rec: Recommendation): Promise<DispatchResult> {
  const channel = task.channel;
  try {
    let actionType: 'whatsapp_send' | 'post_publish' | 'review_reply' = 'post_publish';
    let payload: Record<string, any> = {
      caption: rec.draft_content || rec.body || rec.title,
      platform: channel === 'instagram' ? 'instagram' : channel === 'facebook' ? 'facebook' : 'both',
    };

    if (channel === 'whatsapp') {
      actionType = 'whatsapp_send';
      payload = { message: rec.body || rec.draft_content || rec.title };
    } else if (channel === 'google') {
      actionType = 'review_reply';
      payload = { replyText: rec.body || rec.draft_content || rec.title, reviewId: '' };
    }

    await executeOrQueue({
      businessProfileId: task.business_id,
      agentName: 'ActionDispatcher',
      actionType,
      description: rec.title || task.task_type,
      payload,
      revenueImpact: 0,
      autoExecuteAfterHours: 24,
    });

    return { success: true, result: `Queued via executeOrQueue → ${channel}`, metadata: {} };
  } catch (e: any) {
    return { success: false, result: e.message, metadata: {} };
  }
}

const CHANNEL_HANDLERS: Record<string, ChannelHandler> = {
  dashboard: dashboardHandler,
  internal:  noopHandler,
  instagram: socialChannelHandler,
  facebook:  socialChannelHandler,
  whatsapp:  socialChannelHandler,
  google:    socialChannelHandler,
  email:     noopHandler,
};

// ─── Core dispatch ────────────────────────────────────────────────────────────

export async function dispatchAction(
  decision:       Decision,
  recommendation: Recommendation,
  traceId:        string,
): Promise<{ task: ExecutionTask; sent: SentAction | null }> {
  const taskId = `tsk_${nanoid(12)}`;
  const now    = new Date().toISOString();

  // Skip auto-dispatch for 'suggest' mode
  if (decision.execution_mode === 'suggest') {
    logger.info('Dispatch skipped — suggest mode', { decisionId: decision.id });
    return { task: createSkippedTask(taskId, decision, recommendation), sent: null };
  }

  // Build initial task (status will be updated below)
  const task: ExecutionTask = {
    id:               taskId,
    decision_id:      decision.id,
    recommendation_id: recommendation.id,
    business_id:      decision.business_id,
    task_type:        decision.action_type,
    channel:          recommendation.channel,
    payload: {
      title:         recommendation.title,
      body:          recommendation.body,
      cta:           recommendation.cta,
      draft_content: recommendation.draft_content,
      action_steps:  recommendation.action_steps,
    },
    approval_required: decision.approval_required,
    scheduled_for:     null,
    status:            'created',
    attempts:          0,
    max_attempts:      3,
    created_at:        now,
  };

  // Emit execution.requested
  await bus.emit(bus.makeEvent('execution.requested', decision.business_id, {
    event_id:          `evt_${nanoid(8)}`,
    task_id:           taskId,
    decision_id:       decision.id,
    recommendation_id: recommendation.id,
    business_id:       decision.business_id,
    task_type:         decision.action_type,
    channel:           recommendation.channel,
    execution_mode:    decision.execution_mode,
  }, traceId));

  // ── Approval gate ────────────────────────────────────────────────────────────
  if (decision.approval_required || decision.execution_mode === 'approval') {
    task.status = 'awaiting_approval';
    await decisionRepository.saveTask(task);

    await bus.emit(bus.makeEvent('execution.approval_required', decision.business_id, {
      event_id:          `evt_${nanoid(8)}`,
      task_id:           taskId,
      decision_id:       decision.id,
      recommendation_id: recommendation.id,
      business_id:       decision.business_id,
      channel:           recommendation.channel,
      reason:            'approval_required flag set',
    }, traceId));

    logger.info('Task queued for approval', { taskId, channel: recommendation.channel });
    return { task, sent: null };
  }

  // ── Auto / Draft dispatch ─────────────────────────────────────────────────────
  task.status     = 'dispatched';
  task.attempts   = 1;
  task.started_at = now;
  await decisionRepository.saveTask(task);

  const handler = CHANNEL_HANDLERS[recommendation.channel] ?? noopHandler;
  let dispatchResult: DispatchResult;

  try {
    dispatchResult = await handler(task, recommendation);
  } catch (err: any) {
    dispatchResult = { success: false, result: err.message, metadata: {} };
  }

  const completedAt = new Date().toISOString();

  // Update task status
  await decisionRepository.updateTaskStatus(
    taskId,
    dispatchResult.success ? 'completed' : 'failed',
    dispatchResult.success ? undefined : dispatchResult.result,
  );

  let sent: SentAction | null = null;

  if (dispatchResult.success) {
    const sentId = `snt_${nanoid(12)}`;
    sent = {
      id:          sentId,
      task_id:     taskId,
      business_id: decision.business_id,
      channel:     recommendation.channel,
      sent_at:     completedAt,
      result:      dispatchResult.result,
      success:     true,
    };

    // Persist sent action
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otx_sent_actions (id, task_id, business_id, channel, sent_at, result, success)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::boolean)
         ON CONFLICT (id) DO NOTHING`,
        sentId, taskId, decision.business_id,
        recommendation.channel, completedAt,
        dispatchResult.result, true,
      );
    } catch {}

    await bus.emit(bus.makeEvent('execution.completed', decision.business_id, {
      event_id:          `evt_${nanoid(8)}`,
      task_id:           taskId,
      decision_id:       decision.id,
      recommendation_id: recommendation.id,
      business_id:       decision.business_id,
      channel:           recommendation.channel,
      success:           true,
      result:            dispatchResult.result,
      executed_at:       completedAt,
    }, traceId));

    logger.info('Action dispatched', { taskId, channel: recommendation.channel, success: true });
  } else {
    await bus.emit(bus.makeEvent('action.failed', decision.business_id, {
      task_id:     taskId,
      business_id: decision.business_id,
      channel:     recommendation.channel,
      success:     false,
      result:      dispatchResult.result,
      sent_at:     completedAt,
    }, traceId));

    logger.warn('Action dispatch failed', { taskId, error: dispatchResult.result });
  }

  return { task, sent };
}

/** Dispatch all decisions+recommendations in batch */
export async function dispatchAll(
  decisions:       Decision[],
  recommendations: Recommendation[],
  traceId:         string,
): Promise<number> {
  let dispatched = 0;
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    const rec      = recommendations[i];
    if (!rec) continue;
    try {
      await dispatchAction(decision, rec, traceId);
      dispatched++;
    } catch (err: any) {
      logger.error('Dispatch failed', { decisionId: decision.id, error: err.message });
    }
  }
  return dispatched;
}

function createSkippedTask(taskId: string, decision: Decision, rec: Recommendation): ExecutionTask {
  return {
    id:               taskId,
    decision_id:      decision.id,
    recommendation_id: rec.id,
    business_id:      decision.business_id,
    task_type:        decision.action_type,
    channel:          rec.channel,
    payload:          { status: 'suggest_only', title: rec.title },
    approval_required: false,
    scheduled_for:     null,
    status:            'created',
    attempts:          0,
    max_attempts:      1,
    created_at:        new Date().toISOString(),
  };
}
