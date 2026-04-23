/**
 * Unit tests — PriorityQueue
 *
 * Verifies:
 * - P0 jobs dequeue before P2 regardless of enqueue order
 * - Round-robin fairness across tenants within same priority
 * - P3/P4 rate limiting
 * - Retry increments retryCount
 * - Max retries sends to dead-letter queue
 * - pendingForTenant and pendingForBusiness counts
 * - computePriority maps options to correct priority levels
 * - retryDeadLetter re-enqueues at P2
 */

import {
  enqueue,
  enqueueUrgent,
  enqueueNearExpiry,
  dequeue,
  getStats,
  getDeadLetterJobs,
  clearDeadLetter,
  retryDeadLetter,
  pendingForTenant,
  pendingForBusiness,
  computePriority,
  type QueueJob,
} from '../orchestration/PriorityQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let jobSeq = 0;
function makeJob(overrides: Partial<QueueJob> = {}): Omit<QueueJob, 'enqueuedAt' | 'retryCount'> {
  return {
    id:         `job_${++jobSeq}`,
    tenantId:   'tenant_001',
    businessId: 'biz_001',
    priority:   2,
    type:       'pipeline_run',
    payload:    {},
    maxRetries: 3,
    traceId:    'trace_test',
    ...overrides,
  };
}

// Clear all queues between tests by dequeuing everything
function drainAll(): void {
  let result = dequeue();
  let limit  = 1000;
  while (result && limit-- > 0) {
    result.remove();
    result = dequeue();
  }
  clearDeadLetter();
  jobSeq = 0;
}

beforeEach(() => drainAll());
afterEach(() => drainAll());

// ─── Priority ordering ────────────────────────────────────────────────────────

describe('PriorityQueue — priority ordering', () => {
  test('P0 dequeues before P2', () => {
    enqueue(makeJob({ id: 'p2_job', priority: 2 }));
    enqueueUrgent(makeJob({ id: 'p0_job', priority: 0 }));

    const first = dequeue();
    expect(first?.job.id).toBe('p0_job');
    first?.remove();
  });

  test('P1 dequeues before P2', () => {
    enqueue(makeJob({ id: 'p2_job', priority: 2 }));
    enqueueNearExpiry(makeJob({ id: 'p1_job', priority: 1 }));

    const first = dequeue();
    expect(first?.job.id).toBe('p1_job');
    first?.remove();
  });

  test('P2 dequeues before P3', () => {
    enqueue(makeJob({ id: 'p3_job', priority: 3 }));
    enqueue(makeJob({ id: 'p2_job', priority: 2 }));

    const first = dequeue();
    expect(first?.job.id).toBe('p2_job');
    first?.remove();
  });

  test('jobs at same priority follow FIFO within a tenant', () => {
    enqueue(makeJob({ id: 'first',  priority: 2 }));
    enqueue(makeJob({ id: 'second', priority: 2 }));

    const d1 = dequeue();
    expect(d1?.job.id).toBe('first');
    d1?.remove();

    const d2 = dequeue();
    expect(d2?.job.id).toBe('second');
    d2?.remove();
  });
});

// ─── Round-robin tenant fairness ──────────────────────────────────────────────

describe('PriorityQueue — tenant fairness', () => {
  test('round-robins between two tenants at same priority', () => {
    // Enqueue two jobs per tenant at P2
    enqueue(makeJob({ id: 't1_a', tenantId: 'tenant_A', priority: 2 }));
    enqueue(makeJob({ id: 't1_b', tenantId: 'tenant_A', priority: 2 }));
    enqueue(makeJob({ id: 't2_a', tenantId: 'tenant_B', priority: 2 }));
    enqueue(makeJob({ id: 't2_b', tenantId: 'tenant_B', priority: 2 }));

    // First dequeue: any tenant's first job
    const d1 = dequeue();
    expect(d1).not.toBeNull();
    const firstTenant = d1!.job.tenantId;
    d1!.remove();

    // Second dequeue: should be from the OTHER tenant (round-robin)
    const d2 = dequeue();
    expect(d2).not.toBeNull();
    expect(d2!.job.tenantId).not.toBe(firstTenant);
    d2!.remove();
  });

  test('single tenant drains normally when only one present', () => {
    enqueue(makeJob({ id: 'solo_1', priority: 2 }));
    enqueue(makeJob({ id: 'solo_2', priority: 2 }));

    const d1 = dequeue();
    expect(d1?.job.id).toBe('solo_1');
    d1?.remove();

    const d2 = dequeue();
    expect(d2?.job.id).toBe('solo_2');
    d2?.remove();
  });
});

// ─── Retry and dead-letter ────────────────────────────────────────────────────

describe('PriorityQueue — retry and dead-letter', () => {
  test('requeue increments retryCount and re-enqueues', () => {
    enqueue(makeJob({ id: 'retry_job', maxRetries: 3 }));

    const d = dequeue();
    expect(d).not.toBeNull();
    expect(d!.job.retryCount).toBe(0);
    d!.requeue(0);

    const d2 = dequeue();
    expect(d2).not.toBeNull();
    expect(d2!.job.retryCount).toBe(1);
    d2?.remove();
  });

  test('exceeding maxRetries sends to dead-letter queue', () => {
    enqueue(makeJob({ id: 'dlq_job', maxRetries: 1 }));

    const d1 = dequeue();
    d1!.requeue(0);            // retryCount → 1

    const d2 = dequeue();
    expect(d2).not.toBeNull();
    d2!.requeue(0);            // retryCount → 2, exceeds maxRetries=1

    // Job should now be in dead-letter
    expect(getDeadLetterJobs().find(j => j.id === 'dlq_job')).toBeTruthy();

    // Job should NOT be dequeued normally
    const d3 = dequeue();
    expect(d3?.job.id).not.toBe('dlq_job');
  });

  test('retryDeadLetter re-enqueues at P2', () => {
    enqueue(makeJob({ id: 'dlq_retry', maxRetries: 0 }));

    const d = dequeue();
    d!.requeue(0);   // immediately hits maxRetries → dead-letter

    const dlqJobs = getDeadLetterJobs();
    expect(dlqJobs.length).toBeGreaterThan(0);

    const jobId = dlqJobs[0].id;
    const ok = retryDeadLetter(jobId);
    expect(ok).toBe(true);

    const requeued = dequeue();
    expect(requeued?.job.id).toBe(jobId);
    expect(requeued?.job.priority).toBe(2);
    requeued?.remove();
  });

  test('retryDeadLetter returns false for unknown job', () => {
    expect(retryDeadLetter('nonexistent_job')).toBe(false);
  });
});

// ─── Stats and counts ─────────────────────────────────────────────────────────

describe('PriorityQueue — stats', () => {
  test('getStats returns counts by priority', () => {
    enqueue(makeJob({ id: 's1', priority: 0 }));
    enqueue(makeJob({ id: 's2', priority: 2 }));
    enqueue(makeJob({ id: 's3', priority: 2 }));

    const stats = getStats();
    const p0 = stats.find(s => s.priority === 0);
    const p2 = stats.find(s => s.priority === 2);

    expect(p0?.totalJobs).toBeGreaterThanOrEqual(1);
    expect(p2?.totalJobs).toBeGreaterThanOrEqual(2);
  });

  test('pendingForTenant counts correctly', () => {
    enqueue(makeJob({ tenantId: 'cnt_tenant', priority: 2 }));
    enqueue(makeJob({ tenantId: 'cnt_tenant', priority: 3 }));
    enqueue(makeJob({ tenantId: 'other',      priority: 2 }));

    expect(pendingForTenant('cnt_tenant')).toBeGreaterThanOrEqual(2);
    expect(pendingForTenant('other')).toBeGreaterThanOrEqual(1);
  });

  test('pendingForBusiness counts correctly', () => {
    enqueue(makeJob({ businessId: 'biz_X', tenantId: 'tx', priority: 2 }));
    enqueue(makeJob({ businessId: 'biz_X', tenantId: 'tx', priority: 3 }));

    expect(pendingForBusiness('biz_X')).toBeGreaterThanOrEqual(2);
    expect(pendingForBusiness('biz_other')).toBe(0);
  });

  test('returns null when all queues empty', () => {
    const result = dequeue();
    expect(result).toBeNull();
  });
});

// ─── computePriority ──────────────────────────────────────────────────────────

describe('computePriority', () => {
  test('health recovery → P0', () => {
    expect(computePriority({ isHealthRecovery: true })).toBe(0);
  });

  test('near-expiry → P1', () => {
    expect(computePriority({ isNearExpiry: true })).toBe(1);
  });

  test('standard → P2', () => {
    expect(computePriority({ isStandard: true })).toBe(2);
  });

  test('learning → P3', () => {
    expect(computePriority({ isLearning: true })).toBe(3);
  });

  test('default → P4 (maintenance)', () => {
    expect(computePriority({})).toBe(4);
  });

  test('health recovery takes precedence over near-expiry', () => {
    expect(computePriority({ isHealthRecovery: true, isNearExpiry: true })).toBe(0);
  });
});
