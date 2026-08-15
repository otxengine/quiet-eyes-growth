/**
 * DataForSEO postback webhook
 *
 * POST /api/webhooks/dataforseo?secret=XXX
 *
 * DataForSEO's business_data/google/reviews endpoint is task-based only (no
 * live/sync variant). We submit tasks with postback_data:'advanced', so the
 * full result body lands here as soon as the task completes — same shape as
 * a task_get response (see getGoogleReviewsTaskResult in lib/dataforseo.ts).
 *
 * DataForSEO postbacks aren't signed, so auth is a shared secret in the query
 * string (mirrors the CRON_SECRET convention at /api/cron/run), not HMAC.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { batchExtractTopics } from '../../lib/reviewTaxonomy';
import { getSectorProfile } from '../../lib/businessProfile';
import { resolveTopicSet } from '../../lib/reviewTopicPacks';
import { normReviewOrigin } from '../../lib/signalGuard';
import {
  detectCompetitorMentions, snapshotRatingHistory, createNegativeReviewAlerts,
  publishNewReviewEvents, backfillTopicsFor,
} from '../../lib/reviewPostProcessing';

const router = Router();

export function dataforseoWebhookHandler(req: Request, res: Response) {
  const secret = req.query.secret as string | undefined;
  if (!process.env.DATAFORSEO_WEBHOOK_SECRET || secret !== process.env.DATAFORSEO_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'unauthorized' });
  }

  // Ack immediately — process after responding, same pattern as the Meta webhook.
  res.sendStatus(200);

  processDataForSeoReviewsPostback(req.body).catch(err => {
    console.error('[dataforseo webhook] Processing error:', err.message);
  });
}

router.post('/', dataforseoWebhookHandler);

/**
 * Applies a completed task's result payload (webhook body, or a task_get response
 * reshaped to the same tasks[0] wrapper — see reconcileDataForSeoReviewTasks.ts).
 */
export async function processDataForSeoReviewsPostback(payload: any): Promise<void> {
  const task = payload?.tasks?.[0];
  const taskId: string | undefined = task?.id;
  if (!taskId) {
    console.warn('[dataforseo webhook] Payload missing tasks[0].id — ignoring');
    return;
  }

  const taskRow = await prisma.dataForSeoReviewTask.findUnique({ where: { task_id: taskId } });
  if (!taskRow) {
    console.warn(`[dataforseo webhook] Unknown task_id ${taskId} — ignoring`);
    return;
  }
  // Idempotency — DataForSEO retries postback delivery on failure.
  if (taskRow.status !== 'pending') {
    console.log(`[dataforseo webhook] task_id ${taskId} already ${taskRow.status} — skipping reprocess`);
    return;
  }

  const costUsd = Number(task?.cost) || 0;
  if (task?.status_code !== 20000 && task?.status_code !== 20100) {
    await prisma.dataForSeoReviewTask.update({
      where: { task_id: taskId },
      data: { status: 'error', completed_at: new Date(), error_message: task?.status_message || 'unknown_error', cost_usd: costUsd },
    });
    await writeAutomationLog(
      taskRow.task_type === 'own' ? 'collectReviews' : 'collectCompetitorReviews',
      taskRow.business_profile_id, taskRow.requested_at.toISOString(), 0, 'failed',
      `dataforseo_task_${task?.status_code}:${task?.status_message}`, costUsd,
    );
    return;
  }

  // DataForSEO can chunk a large `depth` request across multiple result[] entries —
  // concatenate all of them rather than only reading result[0].
  const items: any[] = (task?.result ?? []).flatMap((r: any) => r?.items ?? []);
  console.log(`[dataforseo webhook] task ${taskId} (${taskRow.task_type}): received ${items.length} raw items across ${task?.result?.length ?? 0} result chunk(s), cost=$${costUsd}`);
  const startTime = taskRow.requested_at.toISOString();

  const profile = await prisma.businessProfile.findFirst({ where: { id: taskRow.business_profile_id } });
  if (!profile) {
    console.warn(`[dataforseo webhook] business profile ${taskRow.business_profile_id} not found — marking task complete with no writes`);
    await prisma.dataForSeoReviewTask.update({
      where: { task_id: taskId },
      data: { status: 'complete', completed_at: new Date(), cost_usd: costUsd, new_reviews_count: 0 },
    });
    return;
  }
  const sp = getSectorProfile(profile);
  const topicSet = resolveTopicSet(sp?.sector_key ?? 'other', sp?.onboarding_review_extras ?? []);

  const isOwn = taskRow.task_type === 'own';
  const existing = await prisma.review.findMany({
    where: isOwn
      ? { linked_business: taskRow.business_profile_id }
      : { linked_competitor: taskRow.linked_competitor! },
    select: { google_review_id: true, text: true },
  });
  const existingIds = new Set(existing.map(r => r.google_review_id).filter(Boolean));
  const existingKeys = new Set(existing.map(r => (r.text || '').substring(0, 50)));

  const pending: Array<{
    reviewId: string; text: string; rating: number;
    sentiment: string; reviewerName: string; createdAt: string;
  }> = [];

  for (const item of items) {
    // Field mapping confirmed against a real payload (type: google_reviews_search).
    const text: string = item.review_text || item.text || item.snippet || '';
    if (!text || text.length < 5) continue;
    const reviewId: string = item.review_id || item.id || `dfs_${(item.profile_name || item.reviewer_name || '').replace(/[^a-z0-9]/gi, '_').substring(0, 40)}_${text.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}`;
    const textKey = text.substring(0, 50);
    if (existingIds.has(reviewId) || existingKeys.has(textKey)) continue;

    const rating: number = item.rating?.value ?? item.rating ?? 0;
    const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    // item.timestamp is "YYYY-MM-DD HH:mm:ss +00:00" — normalize to real ISO so it sorts
    // correctly alongside created_at strings from the other tiers (GMB/Places/SerpAPI).
    const parsedDate = item.timestamp ? new Date(item.timestamp) : null;
    const createdAt: string = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
    pending.push({ reviewId, text, rating, sentiment, reviewerName: item.profile_name || item.reviewer_name || 'לקוח', createdAt });
    existingIds.add(reviewId);
    existingKeys.add(textKey);
  }

  let newCount = 0;
  if (pending.length > 0) {
    const topics = await batchExtractTopics(pending.map(p => ({ text: p.text })), undefined, topicSet);
    for (let i = 0; i < pending.length; i++) {
      const { reviewId, text, rating, sentiment, reviewerName, createdAt } = pending[i];
      const { topics: t, topic_sentiment } = topics[i];
      try {
        await prisma.review.create({
          data: {
            platform:          'Google',
            rating,
            text:              text.substring(0, 2000),
            reviewer_name:     reviewerName,
            sentiment,
            response_status:   isOwn ? 'pending' : null,
            source_url:        profile.google_place_id ? `https://www.google.com/maps/place/?q=place_id:${profile.google_place_id}` : null,
            source_origin:     normReviewOrigin('dataforseo_google_reviews', 'dataforseoWebhook'),
            google_review_id:  reviewId,
            is_verified:       true,
            created_at:        createdAt,
            linked_business:   taskRow.business_profile_id,
            linked_competitor: isOwn ? undefined : taskRow.linked_competitor,
            topics: t,
            topic_sentiment,
          },
        });
        newCount++;
      } catch { continue; } // dedup race — (linked_business, google_review_id) unique index
    }
  }

  await prisma.dataForSeoReviewTask.update({
    where: { task_id: taskId },
    data: { status: 'complete', completed_at: new Date(), cost_usd: costUsd, new_reviews_count: newCount },
  });

  if (isOwn) {
    await writeAutomationLog('collectReviews', taskRow.business_profile_id, startTime, newCount, 'success', undefined, costUsd);
    if (newCount > 0) {
      await detectCompetitorMentions(taskRow.business_profile_id, startTime);
      await createNegativeReviewAlerts(taskRow.business_profile_id);
      await publishNewReviewEvents(taskRow.business_profile_id, startTime, {
        source: 'dataforseo_postback', extraPayload: { google_added: newCount }, impact: 'medium',
      });
    }
    await snapshotRatingHistory(taskRow.business_profile_id, newCount, 'dataforseo_postback');
    await backfillTopicsFor({ linked_business: taskRow.business_profile_id }, topicSet);
  } else {
    await writeAutomationLog('collectCompetitorReviews', taskRow.business_profile_id, startTime, newCount, 'success', undefined, costUsd);
    await backfillTopicsFor({ linked_competitor: taskRow.linked_competitor! }, topicSet);
  }

  console.log(`[dataforseo webhook] task ${taskId} (${taskRow.task_type}) complete: ${newCount} new reviews`);
}

export default router;
