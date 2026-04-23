/**
 * Unit tests — ApprovalWorkflow
 *
 * Verifies:
 * - createApprovalRequest generates valid request
 * - approveRequest resolves and propagates state
 * - rejectRequest resolves and propagates state
 * - expireStaleApprovals expires timed-out requests
 * - double-resolve throws on already-resolved requests
 */

import {
  createApprovalRequest,
  approveRequest,
  rejectRequest,
  expireStaleApprovals,
  getApprovalRequest,
  type ApprovalRequest,
} from '../services/approval/ApprovalWorkflow';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

// In-memory store simulating DB
const store = new Map<string, ApprovalRequest>();

jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
      if (sql.startsWith('INSERT INTO v3_approval_requests')) {
        const req: ApprovalRequest = {
          id:                args[0],
          business_id:       args[1],
          tenant_id:         args[2],
          decision_id:       args[3],
          recommendation_id: args[4],
          execution_task_id: args[5],
          approval_type:     args[6],
          requested_by:      args[7],
          requested_at:      args[8],
          expires_at:        args[9],
          status:            args[10],
          resolved_by:       args[11],
          resolved_at:       args[12],
          notes:             args[13],
        };
        store.set(req.id, req);
      } else if (sql.startsWith('UPDATE v3_approval_requests')) {
        // args: status, resolved_by, resolved_at, notes, id
        const id = args[4];
        const existing = store.get(id);
        if (existing) {
          store.set(id, { ...existing, status: args[0], resolved_by: args[1], resolved_at: args[2], notes: args[3] });
        }
      } else if (sql.startsWith('UPDATE v3_decisions') || sql.startsWith('UPDATE v3_execution_tasks')) {
        // no-op in tests
      }
    }),
    $queryRawUnsafe: jest.fn(async (_sql: string, id: string, businessId: string) => {
      const req = store.get(id);
      if (req && req.business_id === businessId) return [req];
      return [];
    }),
  },
}));

// Mock AuditLogger
jest.mock('../infra/AuditLogger', () => ({
  auditApprovalAction: jest.fn().mockResolvedValue(undefined),
  auditPolicyRejection: jest.fn().mockResolvedValue(undefined),
}));

// Mock EventBus
jest.mock('../events/EventBus', () => ({
  bus: {
    emit: jest.fn().mockResolvedValue(undefined),
    makeEvent: jest.fn((type: string, entityId: string, payload: any) => ({
      event_id: 'evt_test',
      type,
      entity_id: entityId,
      payload,
      timestamp: new Date().toISOString(),
      trace_id:  '',
      version:   1,
    })),
  },
}));

// Mock state machines to prevent DB operations
jest.mock('../state/StateMachines', () => ({
  assertTransitionWithAudit: jest.fn().mockResolvedValue(undefined),
  DECISION_TRANSITIONS:      {},
  TASK_TRANSITIONS:          {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

async function createTestRequest(overrides: Partial<{
  timeoutHours: number;
  executionTaskId: string;
}> = {}): Promise<ApprovalRequest> {
  return createApprovalRequest({
    businessId:      'biz_001',
    decisionId:      'dec_001',
    recommendationId: 'rec_001',
    executionTaskId: overrides.executionTaskId ?? 'task_001',
    approvalType:    'execution',
    requestedBy:     'system',
    timeoutHours:    overrides.timeoutHours ?? 24,
  });
}

// ─── createApprovalRequest ────────────────────────────────────────────────────

describe('createApprovalRequest', () => {
  test('creates request with pending status', async () => {
    const req = await createTestRequest();
    expect(req.status).toBe('pending');
  });

  test('generates unique id starting with apr_', async () => {
    const req = await createTestRequest();
    expect(req.id).toMatch(/^apr_/);
  });

  test('sets expires_at in the future', async () => {
    const req = await createTestRequest({ timeoutHours: 1 });
    expect(new Date(req.expires_at!).getTime()).toBeGreaterThan(Date.now());
  });

  test('populates all required fields', async () => {
    const req = await createTestRequest();
    expect(req.business_id).toBe('biz_001');
    expect(req.decision_id).toBe('dec_001');
    expect(req.approval_type).toBe('execution');
    expect(req.requested_by).toBe('system');
    expect(req.resolved_by).toBeNull();
    expect(req.resolved_at).toBeNull();
  });
});

// ─── approveRequest ───────────────────────────────────────────────────────────

describe('approveRequest', () => {
  test('changes status to approved', async () => {
    const req  = await createTestRequest();
    const result = await approveRequest(req.id, 'biz_001', 'user_123');
    expect(result.request.status).toBe('approved');
  });

  test('sets resolved_by to approver', async () => {
    const req  = await createTestRequest();
    const result = await approveRequest(req.id, 'biz_001', 'user_123');
    expect(result.request.resolved_by).toBe('user_123');
  });

  test('sets resolved_at timestamp', async () => {
    const req  = await createTestRequest();
    const result = await approveRequest(req.id, 'biz_001', 'user_123');
    expect(result.request.resolved_at).toBeTruthy();
  });

  test('propagated is true', async () => {
    const req  = await createTestRequest();
    const result = await approveRequest(req.id, 'biz_001', 'user_123');
    expect(result.propagated).toBe(true);
  });

  test('throws when request not found', async () => {
    await expect(approveRequest('apr_nonexistent', 'biz_001', 'user_123'))
      .rejects.toThrow('not found');
  });

  test('throws on double-approve (already resolved)', async () => {
    const req = await createTestRequest();
    await approveRequest(req.id, 'biz_001', 'user_123');
    // Manually mark as approved in store for second call
    const stored = store.get(req.id)!;
    store.set(req.id, { ...stored, status: 'approved' });
    await expect(approveRequest(req.id, 'biz_001', 'user_123'))
      .rejects.toThrow(/already approved/);
  });
});

// ─── rejectRequest ────────────────────────────────────────────────────────────

describe('rejectRequest', () => {
  test('changes status to rejected', async () => {
    const req  = await createTestRequest();
    const result = await rejectRequest(req.id, 'biz_001', 'user_123', 'user', 'Not relevant now');
    expect(result.request.status).toBe('rejected');
  });

  test('sets resolved_by to rejector', async () => {
    const req  = await createTestRequest();
    const result = await rejectRequest(req.id, 'biz_001', 'user_123');
    expect(result.request.resolved_by).toBe('user_123');
  });

  test('notes are preserved', async () => {
    const req  = await createTestRequest();
    const result = await rejectRequest(req.id, 'biz_001', 'user_123', 'user', 'Wrong timing');
    expect(result.request.notes).toBe('Wrong timing');
  });

  test('propagated is true', async () => {
    const req  = await createTestRequest();
    const result = await rejectRequest(req.id, 'biz_001', 'user_123');
    expect(result.propagated).toBe(true);
  });

  test('throws when request not found', async () => {
    await expect(rejectRequest('apr_bad', 'biz_001', 'user_123'))
      .rejects.toThrow('not found');
  });
});

// ─── expireStaleApprovals ─────────────────────────────────────────────────────

describe('expireStaleApprovals', () => {
  test('returns 0 when no pending requests', async () => {
    const count = await expireStaleApprovals('biz_001');
    expect(count).toBe(0);
  });

  test('expires requests past their deadline', async () => {
    // Create request with 0-hour timeout (already expired)
    const req = await createTestRequest({ timeoutHours: 0 });

    // Override the mock to return this request from getPendingApprovals
    const { prisma } = require('../db');
    const expiredReq = {
      ...req,
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    };
    store.set(req.id, expiredReq);
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...args: any[]) => {
      if (sql.includes("status = 'pending'")) return [expiredReq];
      const id = args[0]; const biz = args[1];
      const r = store.get(id);
      return r && r.business_id === biz ? [r] : [];
    });

    const count = await expireStaleApprovals('biz_001');
    expect(count).toBe(1);
  });

  test('does not expire requests within deadline', async () => {
    const req = await createTestRequest({ timeoutHours: 48 });

    const { prisma } = require('../db');
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...args: any[]) => {
      if (sql.includes("status = 'pending'")) return [req];
      const id = args[0]; const biz = args[1];
      const r = store.get(id);
      return r && r.business_id === biz ? [r] : [];
    });

    const count = await expireStaleApprovals('biz_001');
    expect(count).toBe(0);
  });
});
