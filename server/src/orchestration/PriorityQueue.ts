/**
 * PriorityQueue — tenant-aware, fair orchestration queue.
 *
 * Priority classes:
 *   P0 — health / failure recovery           (immediate)
 *   P1 — urgent opportunity (narrow window)  (next cycle)
 *   P2 — standard intelligence→recommendation flow
 *   P3 — background learning / memory compaction
 *   P4 — archival / maintenance / low-urgency
 *
 * Fairness rules:
 * - Round-robin across tenants within the same priority class
 * - One tenant cannot starve others at any priority level
 * - Learning/background (P3/P4) jobs are rate-limited
 * - Urgent near-expiry opportunities preempt P2 and below
 *
 * Retry / Dead-Letter:
 * - Failed jobs increment retry count; max 3 retries before dead-letter
 * - Dead-letter queue is drained manually or by a separate process
 */

import { createLogger } from '../infra/logger';

const logger = createLogger('PriorityQueue');

// ─── Types ────────────────────────────────────────────────────────────────────

export type Priority = 0 | 1 | 2 | 3 | 4;

export interface QueueJob {
  id:          string;
  tenantId:    string;
  businessId:  string;
  priority:    Priority;
  type:        string;      // e.g. 'pipeline_run', 'learning_cycle', 'archive'
  payload:     unknown;
  enqueuedAt:  string;      // ISO 8601
  retryCount:  number;
  maxRetries:  number;
  traceId:     string;
}

export interface DequeueResult {
  job:       QueueJob;
  remove:    () => void;    // call after successful processing
  requeue:   (delay?: number) => void;  // call to retry
}

// ─── In-memory queues (production: replace with Redis ZADD / SQS) ─────────────

// Five priority buckets, each containing a FIFO list per tenant
type TenantBucket = Map<string, QueueJob[]>;   // tenantId → jobs
const queues: TenantBucket[] = [
  new Map(), // P0
  new Map(), // P1
  new Map(), // P2
  new Map(), // P3
  new Map(), // P4
];

const deadLetterQueue: QueueJob[] = [];

// Per-priority round-robin cursor: tenantId at which to start next dequeue
const rrCursor: (string | null)[] = [null, null, null, null, null];

// Rate-limit counters for P3/P4 (jobs-per-minute)
const RATE_LIMITS: Record<number, number> = { 3: 10, 4: 3 };
const rateCounts: Record<number, { count: number; resetAt: number }> = {
  3: { count: 0, resetAt: Date.now() + 60_000 },
  4: { count: 0, resetAt: Date.now() + 60_000 },
};

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/** Internal: push a fully-constructed job into the bucket (preserves retryCount). */
function _push(full: QueueJob): void {
  const bucket = queues[full.priority];
  if (!bucket.has(full.tenantId)) bucket.set(full.tenantId, []);
  bucket.get(full.tenantId)!.push(full);
  logger.debug('Job enqueued', {
    id: full.id, priority: full.priority, type: full.type,
    tenantId: full.tenantId, businessId: full.businessId, retryCount: full.retryCount,
  });
}

export function enqueue(job: Omit<QueueJob, 'enqueuedAt' | 'retryCount'>): void {
  _push({ ...job, enqueuedAt: new Date().toISOString(), retryCount: 0 });
}

/** Enqueue a job at P0 priority — for health/failure recovery */
export function enqueueUrgent(job: Omit<QueueJob, 'enqueuedAt' | 'retryCount' | 'priority'>): void {
  enqueue({ ...job, priority: 0 });
}

/** Enqueue a near-expiry opportunity at P1 */
export function enqueueNearExpiry(job: Omit<QueueJob, 'enqueuedAt' | 'retryCount' | 'priority'>): void {
  enqueue({ ...job, priority: 1 });
}

// ─── Dequeue (with fairness) ──────────────────────────────────────────────────

/**
 * Dequeue the next job to process.
 * Always returns the highest-priority available job.
 * Within a priority level, round-robins across tenants for fairness.
 * Returns null if all queues are empty or rate-limited.
 */
export function dequeue(): DequeueResult | null {
  for (let p = 0 as Priority; p <= 4; p++) {
    // Rate-limit check for P3/P4
    if (p === 3 || p === 4) {
      const limit = RATE_LIMITS[p];
      const state = rateCounts[p];
      if (Date.now() > state.resetAt) {
        state.count  = 0;
        state.resetAt = Date.now() + 60_000;
      }
      if (state.count >= limit) continue;
    }

    const job = _dequeueFromPriority(p as Priority);
    if (!job) continue;

    // Count against rate limit
    if (p === 3 || p === 4) rateCounts[p].count++;

    let removed = false;
    return {
      job,
      remove: () => {
        if (!removed) {
          removed = true;
          logger.debug('Job completed', { id: job.id, priority: p });
        }
      },
      requeue: (delay = 0) => {
        if (job.retryCount >= job.maxRetries) {
          deadLetterQueue.push({ ...job, retryCount: job.retryCount + 1 });
          logger.error('Job dead-lettered', { id: job.id, retries: job.retryCount });
          return;
        }
        const retry: QueueJob = { ...job, enqueuedAt: new Date().toISOString(), retryCount: job.retryCount + 1 };
        if (delay > 0) {
          setTimeout(() => _push(retry), delay);
        } else {
          _push(retry);
        }
        logger.warn('Job requeued for retry', { id: job.id, attempt: retry.retryCount });
      },
    };
  }
  return null;
}

function _dequeueFromPriority(p: Priority): QueueJob | null {
  const bucket  = queues[p];
  const tenants = [...bucket.keys()].filter(t => (bucket.get(t)?.length ?? 0) > 0);
  if (tenants.length === 0) return null;

  // Round-robin: find cursor position in tenant list
  const cursor  = rrCursor[p];
  const idx     = cursor ? tenants.indexOf(cursor) : -1;
  const start   = idx >= 0 ? (idx + 1) % tenants.length : 0;

  // Rotate through tenants starting at cursor+1
  for (let i = 0; i < tenants.length; i++) {
    const tenantId = tenants[(start + i) % tenants.length];
    const jobs     = bucket.get(tenantId)!;
    if (jobs.length === 0) continue;

    rrCursor[p] = tenantId;
    return jobs.shift()!;
  }
  return null;
}

// ─── Inspection ───────────────────────────────────────────────────────────────

export interface QueueStats {
  priority:   Priority;
  totalJobs:  number;
  tenants:    { tenantId: string; jobs: number }[];
}

export function getStats(): QueueStats[] {
  return ([0, 1, 2, 3, 4] as Priority[]).map(p => {
    const bucket = queues[p];
    const tenants = [...bucket.entries()]
      .map(([tenantId, jobs]) => ({ tenantId, jobs: jobs.length }))
      .filter(t => t.jobs > 0);
    return {
      priority:  p,
      totalJobs: tenants.reduce((s, t) => s + t.jobs, 0),
      tenants,
    };
  });
}

export function getDeadLetterJobs(): QueueJob[] {
  return [...deadLetterQueue];
}

export function clearDeadLetter(): void {
  deadLetterQueue.length = 0;
}

/** Drain dead-letter: re-enqueue at P2 for manual retry */
export function retryDeadLetter(jobId: string): boolean {
  const idx = deadLetterQueue.findIndex(j => j.id === jobId);
  if (idx === -1) return false;
  const [job] = deadLetterQueue.splice(idx, 1);
  _push({ ...job, priority: 2, retryCount: 0, enqueuedAt: new Date().toISOString() });
  logger.info('Dead-letter job re-enqueued', { id: jobId });
  return true;
}

/** Returns number of pending jobs across all queues for a tenant */
export function pendingForTenant(tenantId: string): number {
  return queues.reduce((total, bucket) => total + (bucket.get(tenantId)?.length ?? 0), 0);
}

/** Returns number of pending jobs for a specific business */
export function pendingForBusiness(businessId: string): number {
  return queues.reduce((total, bucket) => {
    return total + [...bucket.values()].reduce((s, jobs) =>
      s + jobs.filter(j => j.businessId === businessId).length, 0,
    );
  }, 0);
}

// ─── Priority helpers ─────────────────────────────────────────────────────────

/** Determine job priority from context metadata */
export function computePriority(opts: {
  isHealthRecovery?: boolean;
  isNearExpiry?:     boolean;
  isStandard?:       boolean;
  isLearning?:       boolean;
  isMaintenance?:    boolean;
}): Priority {
  if (opts.isHealthRecovery) return 0;
  if (opts.isNearExpiry)     return 1;
  if (opts.isStandard)       return 2;
  if (opts.isLearning)       return 3;
  return 4;
}
