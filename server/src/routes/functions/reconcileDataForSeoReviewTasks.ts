/**
 * Fallback for missed DataForSEO postbacks — DataForSEO's postback delivery
 * isn't guaranteed (our server could be down, network blip). This periodically
 * fetches results directly for tasks stuck pending past STUCK_THRESHOLD_MS and
 * runs them through the same completion path the webhook uses.
 */
import { prisma } from '../../db';
import { getGoogleReviewsTaskResult } from '../../lib/dataforseo';
import { processDataForSeoReviewsPostback } from '../webhooks/dataforseo';

const STUCK_THRESHOLD_MS = 45 * 60 * 1000;

export async function reconcileDataForSeoReviewTasks(): Promise<void> {
  const stuck = await prisma.dataForSeoReviewTask.findMany({
    where: { status: 'pending', requested_at: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) } },
    take: 50,
  });
  if (stuck.length === 0) return;

  console.log(`[reconcileDataForSeoReviewTasks] ${stuck.length} task(s) stuck pending — fetching directly`);
  for (const t of stuck) {
    const { items, costUsd, statusCode } = await getGoogleReviewsTaskResult(t.task_id);
    if (statusCode == null) continue; // not ready yet or fetch failed — leave pending, retry next sweep
    await processDataForSeoReviewsPostback({
      tasks: [{ id: t.task_id, status_code: statusCode, cost: costUsd, result: [{ items }] }],
    }).catch(err => console.error(`[reconcileDataForSeoReviewTasks] task ${t.task_id} failed:`, err.message));
  }
}
