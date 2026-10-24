/**
 * Org roles are enforced, not just labels: the ownership lookup (server/src/lib/ownership.ts)
 * carries each business's role, viewers keep read access but can't write through the entities API
 * or a mutating /api/functions call, and billing is for the org's owner and admins.
 * Runs the real ownership module against a mocked database.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn(), findUnique: jest.fn() },
    lead: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    competitor: { count: jest.fn(), findUnique: jest.fn() },
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => 'user-a'), isAdminKeyRequest: jest.fn(() => false) }));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/paddle', () => ({
  ...jest.requireActual('../lib/paddle'),
  paddleEnabled: jest.fn(() => false),
  paddleRequest: jest.fn(),
}));

import { Request, Response } from 'express';
import { prisma } from '../db';
import { paddleEnabled, paddleRequest } from '../lib/paddle';
import { getUserBusinessIds, getUserWritableBusinessIds } from '../lib/ownership';

const db = prisma as any;

// user-a created biz-own, is a viewer of org-v (branch biz-v) and a content editor of org-e (biz-e).
let memberships: { org_id: string; role: string; branch_ids: string | null }[];
let branches: Record<string, string[]>;
let billingRole: string; // user-a's role in the org billing routes look up

beforeEach(() => {
  memberships = [
    { org_id: 'org-v', role: 'viewer', branch_ids: null },
    { org_id: 'org-e', role: 'content_editor', branch_ids: null },
  ];
  branches = { 'org-v': ['biz-v'], 'org-e': ['biz-e'] };
  billingRole = 'viewer';
  db.businessProfile.findMany.mockImplementation(async ({ where }: any) =>
    (where.created_by === 'user-a' ? [{ id: 'biz-own' }] : []));
  db.$queryRawUnsafe.mockImplementation(async (sql: string, arg: string) => {
    if (sql.includes('FROM organization_members WHERE user_id')) return memberships;
    if (sql.includes('FROM business_profiles WHERE organization_id')) return (branches[arg] ?? []).map(id => ({ id }));
    if (sql.includes('FROM organizations o')) {
      return [{ id: 'org-v', plan_id: 'starter', branch_count: 1, member_role: billingRole, paddle_customer_id: 'ctm_1' }];
    }
    return [];
  });
  db.$executeRawUnsafe.mockResolvedValue(1);
  (paddleEnabled as jest.Mock).mockReturnValue(false);
});

function makeRes() {
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis(), setHeader: jest.fn() } as unknown as Response;
  return { res, json, status: () => (res.status as jest.Mock).mock.calls[0]?.[0] ?? 200 };
}

// Runs every handler of the route (method, path), express-style.
async function run(router: any, method: string, path: string, req: object) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const r = makeRes();
  let i = 0;
  const next = async (err?: any) => {
    if (err) throw err;
    const h = handlers[i++];
    if (h) await h({ headers: {}, query: {}, params: {}, body: {}, ...req } as unknown as Request, r.res, next);
  };
  await next();
  await new Promise(resolve => setImmediate(resolve)); // express-rate-limit calls next() without awaiting it
  return r;
}

describe('ownership lookup carries the role', () => {
  it('reads every business, but writes only those not reached as a viewer', async () => {
    expect((await getUserBusinessIds('user-a')).sort()).toEqual(['biz-e', 'biz-own', 'biz-v']);
    expect((await getUserWritableBusinessIds('user-a')).sort()).toEqual(['biz-e', 'biz-own']);
  });

  it('keeps write access when the same business is also reached as a viewer', async () => {
    branches['org-v'] = ['biz-v', 'biz-own'];
    expect(await getUserWritableBusinessIds('user-a')).toContain('biz-own');
  });

  it('treats roles it does not know as read-only', async () => {
    memberships = [{ org_id: 'org-v', role: 'member', branch_ids: null }];
    expect(await getUserBusinessIds('user-a')).toContain('biz-v');
    expect(await getUserWritableBusinessIds('user-a')).not.toContain('biz-v');
  });
});

describe('entities API as an org viewer', () => {
  const router = require('../routes/entities').default;

  it('still lists the viewer\'s org data', async () => {
    db.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
    const r = await run(router, 'get', '/:entity', {
      params: { entity: 'Lead' }, query: { filter: JSON.stringify({ linked_business: 'biz-v' }) },
    });
    expect(r.status()).toBe(200);
    expect(r.json).toHaveBeenCalledWith([{ id: 'lead-1' }]);
  });

  it('refuses to create a row in a business the caller only views', async () => {
    let r = await run(router, 'post', '/:entity', { params: { entity: 'Lead' }, body: { linked_business: 'biz-v' } });
    expect(r.status()).toBe(403);
    expect(db.lead.create).not.toHaveBeenCalled();

    db.lead.create.mockResolvedValue({ id: 'lead-2' });
    r = await run(router, 'post', '/:entity', { params: { entity: 'Lead' }, body: { linked_business: 'biz-e' } });
    expect(r.status()).toBe(201); // content editors write
  });

  it('refuses to update or delete a viewer business\'s rows, even ones the caller created', async () => {
    db.lead.findFirst.mockResolvedValue({ id: 'lead-1', linked_business: 'biz-v', created_by: 'user-a' });
    const patch = await run(router, 'patch', '/:entity/:id', { params: { entity: 'Lead', id: 'lead-1' }, body: { status: 'won' } });
    const del = await run(router, 'delete', '/:entity/:id', { params: { entity: 'Lead', id: 'lead-1' } });
    expect(patch.status()).toBe(403);
    expect(del.status()).toBe(403);
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(db.lead.delete).not.toHaveBeenCalled();
  });

  it('lets a content editor update their org\'s rows', async () => {
    db.lead.findFirst.mockResolvedValue({ id: 'lead-1', linked_business: 'biz-e', created_by: 'someone-else' });
    db.lead.update.mockResolvedValue({ id: 'lead-1' });
    const r = await run(router, 'patch', '/:entity/:id', { params: { entity: 'Lead', id: 'lead-1' }, body: { status: 'won' } });
    expect(r.status()).toBe(200);
  });
});

describe('/api/functions as an org viewer', () => {
  const router = require('../routes/functions').default;
  const fn = (name: string, body: object) => run(router, 'post', '/:name', { params: { name }, body });

  it('refuses functions that change data for a business the caller only views', async () => {
    // Unknown function names count as mutating; passing the guard would 404 instead.
    expect((await fn('__nonexistent_fn__', { businessProfileId: 'biz-v' })).status()).toBe(403);
    expect((await fn('__nonexistent_fn__', { businessProfileId: 'biz-e' })).status()).toBe(404);
    expect((await fn('__nonexistent_fn__', { businessProfileId: 'biz-own' })).status()).toBe(404);
  });

  it('checks record ids against the businesses the caller can write', async () => {
    db.competitor.count.mockResolvedValue(0);
    await fn('__nonexistent_fn__', { competitorId: 'comp-1' });
    const where = JSON.stringify(db.competitor.count.mock.calls[0][0].where);
    expect(where).toContain('biz-e');
    expect(where).not.toContain('biz-v');
  });

  it('still allows read-only functions', async () => {
    const r = await fn('getSubscriptionStatus', { businessProfileId: 'biz-v' });
    expect(r.status()).toBe(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ plan_id: expect.any(String) }));
  });
});

describe('billing is for the org\'s owner and admins', () => {
  const router = require('../routes/billing').default;

  it('refuses plan changes, the Paddle portal, quantity sync and invoices to other members', async () => {
    (paddleEnabled as jest.Mock).mockReturnValue(true);
    for (const role of ['viewer', 'content_editor', 'manager']) {
      billingRole = role;
      expect((await run(router, 'post', '/checkout', { body: { planId: 'growth', orgId: 'org-v' } })).status()).toBe(403);
      expect((await run(router, 'post', '/portal', { body: { orgId: 'org-v' } })).status()).toBe(403);
      expect((await run(router, 'post', '/update-quantity', { body: { orgId: 'org-v' } })).status()).toBe(403);
      expect((await run(router, 'get', '/invoices/:txnId/pdf', { params: { txnId: 'txn_1' }, query: { orgId: 'org-v' } })).status()).toBe(403);
    }
    expect(paddleRequest).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('lets an owner or admin change the plan and open the portal', async () => {
    for (const role of ['owner', 'admin']) {
      billingRole = role;
      (paddleEnabled as jest.Mock).mockReturnValue(false); // local dev: plan flips directly
      const checkout = await run(router, 'post', '/checkout', { body: { planId: 'growth', orgId: 'org-v' } });
      expect(checkout.json).toHaveBeenCalledWith({ ok: true, devBypass: true });

      (paddleEnabled as jest.Mock).mockReturnValue(true);
      (paddleRequest as jest.Mock).mockResolvedValue({ urls: { general: { overview: 'https://portal.test' } } });
      const portal = await run(router, 'post', '/portal', { body: { orgId: 'org-v' } });
      expect(portal.json).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://portal.test' }));
    }
  });

  it('shows the plan to every member, but the card and charges only to billing managers', async () => {
    let r = await run(router, 'get', '/status', { query: { orgId: 'org-v' } });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'starter', paymentMethod: null, invoices: [], canManageBilling: false,
    }));

    billingRole = 'admin';
    r = await run(router, 'get', '/status', { query: { orgId: 'org-v' } });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ canManageBilling: true }));
  });
});
