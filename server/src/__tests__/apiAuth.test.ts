/**
 * /api deny-by-default gate (middleware/apiAuth.ts) and the tenant guards in
 * middleware/businessAccess.ts, plus their wiring on the routers that were
 * reachable without a signed-in user (confirmed on staging 2026-10-24:
 * GET /api/social/snapshot/profile answered 200 with no token).
 */
jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(), requireAdmin: jest.fn() }));
jest.mock('../lib/ownership', () => ({ getUserBusinessIds: jest.fn(), getUserEmail: jest.fn() }));
// requireAdmin's real module requires this lazily, at call time.
jest.mock('@clerk/express', () => ({ getAuth: jest.fn() }));

import { Request, Response } from 'express';
import { getUserId, requireAdmin } from '../middleware/auth';
import { getUserBusinessIds } from '../lib/ownership';
import { requireApiAuth } from '../middleware/apiAuth';
import {
  requireOwnsBusinessFields, ownsBusinessParam, requireOwnsRecord,
} from '../middleware/businessAccess';

const asUser = (id: string | null, owned: string[] = []) => {
  (getUserId as jest.Mock).mockReturnValue(id);
  (getUserBusinessIds as jest.Mock).mockResolvedValue(owned);
};
const req = (r: Partial<Request> & Record<string, any>) =>
  ({ query: {}, body: {}, params: {}, headers: {}, path: '/', ...r }) as unknown as Request;
function run(mw: any, r: Request, ...extra: any[]) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn();
  return Promise.resolve(mw(r, res, next, ...extra)).then(() => ({ status: (res.status as jest.Mock).mock.calls[0]?.[0], next }));
}

describe('requireApiAuth (mounted on /api)', () => {
  it.each(['/social/snapshot/profile', '/kpi/biz-1', '/agents/trigger/collect-reviews', '/orchestrator/running', '/meta/auth/facebook/callback'])(
    '401s %s without a user', async path => {
      asUser(null);
      expect((await run(requireApiAuth, req({ path }))).status).toBe(401);
    });

  it.each(['/health', '/healthz', '/cron/run', '/webhooks/clerk', '/webhooks/meta', '/billing/webhooks',
    '/oauth/callback/google', '/oauth/confirm-page', '/competitors/proxy-image', '/social/media/asset-1'])(
    'lets %s through without a user', async path => {
      asUser(null);
      expect((await run(requireApiAuth, req({ path }))).next).toHaveBeenCalled();
    });

  it('lets a signed-in user through, and an x-admin-key header alone nowhere', async () => {
    asUser('user-a');
    expect((await run(requireApiAuth, req({ path: '/kpi/biz-1' }))).next).toHaveBeenCalled();
    asUser(null);
    expect((await run(requireApiAuth, req({ path: '/kpi/biz-1', headers: { 'x-admin-key': 'anything' } }))).status).toBe(401);
  });
});

describe('requireOwnsBusinessFields', () => {
  it('403s another tenant\'s id in the query or body', async () => {
    asUser('user-a', ['biz-a']);
    expect((await run(requireOwnsBusinessFields, req({ query: { businessProfileId: 'biz-b' } }))).status).toBe(403);
    expect((await run(requireOwnsBusinessFields, req({ body: { businessId: 'biz-b' } }))).status).toBe(403);
  });

  it('400s non-string ids so Prisma operators can\'t be smuggled in', async () => {
    asUser('user-a', ['biz-a']);
    expect((await run(requireOwnsBusinessFields, req({ body: { businessProfileId: { not: 'x' } } }))).status).toBe(400);
    expect((await run(requireOwnsBusinessFields, req({ query: { businessId: ['biz-a', 'biz-b'] } }))).status).toBe(400);
  });

  it('passes owned ids, and requests with no business id at all', async () => {
    asUser('user-a', ['biz-a']);
    expect((await run(requireOwnsBusinessFields, req({ query: { businessProfileId: 'biz-a' } }))).next).toHaveBeenCalled();
    asUser(null);
    expect((await run(requireOwnsBusinessFields, req({ query: { url: 'https://x.cdninstagram.com/a.jpg' } }))).next).toHaveBeenCalled();
  });

  it('401s an id without a user', async () => {
    asUser(null);
    expect((await run(requireOwnsBusinessFields, req({ query: { businessId: 'biz-b' } }))).status).toBe(401);
  });
});

describe('ownsBusinessParam / requireOwnsRecord', () => {
  it('ownsBusinessParam 403s another tenant\'s path param', async () => {
    asUser('user-a', ['biz-a']);
    expect((await run(ownsBusinessParam, req({}), 'biz-b')).status).toBe(403);
    expect((await run(ownsBusinessParam, req({}), 'biz-a')).next).toHaveBeenCalled();
  });

  it('requireOwnsRecord 404s rows of other tenants and missing rows alike', async () => {
    asUser('user-a', ['biz-a']);
    const owner: Record<string, string> = { 'c-own': 'biz-a', 'c-other': 'biz-b' };
    const mw = requireOwnsRecord(async id => owner[id]);
    expect((await run(mw, req({ params: { id: 'c-other' } }))).status).toBe(404);
    expect((await run(mw, req({ params: { id: 'c-missing' } }))).status).toBe(404);
    expect((await run(mw, req({ params: { id: 'c-own' } }))).next).toHaveBeenCalled();
  });
});

describe('requireAdmin (middleware/auth.ts)', () => {
  // The real module, loaded fresh per case: ADMIN_USER_IDS and the Clerk keys are read at load.
  function load(env: Record<string, string>, clerkAuth: object) {
    require('@clerk/express').getAuth.mockReturnValue(clerkAuth);
    const saved = { ...process.env };
    Object.assign(process.env, env);
    let mw: any;
    jest.isolateModules(() => { mw = jest.requireActual('../middleware/auth').requireAdmin; });
    process.env = saved;
    return mw;
  }
  const clerkEnv = { ADMIN_USER_IDS: 'user_admin, user_other', CLERK_SECRET_KEY: 'sk_test_x', CLERK_PUBLISHABLE_KEY: 'pk_test_x' };
  const body = (r: Response) => ((r.json as jest.Mock).mock.calls[0] ?? [])[0];
  async function call(mw: any) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    const r = req({});
    await mw(r, res, next);
    return { status: (res.status as jest.Mock).mock.calls[0]?.[0], error: body(res)?.error, next, adminUserId: (r as any).adminUserId };
  }

  it('lets an allowlisted user with a second factor through', async () => {
    const out = await call(load(clerkEnv, { userId: 'user_admin', factorVerificationAge: [3, 3] }));
    expect(out.next).toHaveBeenCalled();
    expect(out.adminUserId).toBe('user_admin');
  });

  it('403s an allowlisted user whose session has no second factor', async () => {
    expect(await call(load(clerkEnv, { userId: 'user_admin', factorVerificationAge: [3, -1] })))
      .toMatchObject({ status: 403, error: 'mfa_required' });
    expect(await call(load(clerkEnv, { userId: 'user_admin', factorVerificationAge: null })))
      .toMatchObject({ status: 403, error: 'mfa_required' });
  });

  it('403s users not on the list, and everyone when the list is unset', async () => {
    expect(await call(load(clerkEnv, { userId: 'user_x', factorVerificationAge: [3, 3] })))
      .toMatchObject({ status: 403, error: 'not_admin' });
    expect(await call(load({ ...clerkEnv, ADMIN_USER_IDS: '' }, { userId: 'user_admin', factorVerificationAge: [3, 3] })))
      .toMatchObject({ status: 403, error: 'not_admin' });
  });

  it('refuses everyone in production when Clerk is not configured', async () => {
    const out = await call(load({ ADMIN_USER_IDS: 'dev-user', NODE_ENV: 'production', CLERK_SECRET_KEY: '', CLERK_PUBLISHABLE_KEY: '' }, {}));
    expect(out).toMatchObject({ status: 503, error: 'auth_not_configured' });
  });

  it('401s a signed-out request', async () => {
    expect(await call(load(clerkEnv, { userId: null, factorVerificationAge: null }))).toMatchObject({ status: 401 });
  });
});

describe('getUserBusinessIds — org manager branches', () => {
  it('keeps only branch_ids that really belong to the inviting org', async () => {
    const { prisma } = require('../db');
    prisma.businessProfile = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.$queryRawUnsafe = jest.fn()
      .mockResolvedValueOnce([{ org_id: 'org-a', role: 'manager', branch_ids: JSON.stringify(['biz-a1', 'victim-biz']) }])
      .mockResolvedValueOnce([{ id: 'biz-a1' }]); // the org-scoped lookup: only biz-a1 is org-a's
    const { getUserBusinessIds: real } = jest.requireActual('../lib/ownership');

    expect(await real('user-m')).toEqual(['biz-a1']);
    expect(prisma.$queryRawUnsafe).toHaveBeenLastCalledWith(
      expect.stringContaining('organization_id = $1 AND id = ANY($2::text[])'), 'org-a', ['biz-a1', 'victim-biz']);
  });

  it('grants nothing for malformed branch_ids (fail closed, not full-org access)', async () => {
    const { prisma } = require('../db');
    prisma.businessProfile = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.$queryRawUnsafe = jest.fn().mockResolvedValueOnce([{ org_id: 'org-a', role: 'manager', branch_ids: 'not-json' }]);
    const { getUserBusinessIds: real } = jest.requireActual('../lib/ownership');

    expect(await real('user-m')).toEqual([]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe('router wiring', () => {
  const routeHandlers = (router: any, method: string, path: string) =>
    router.stack.find((l: any) => l.route?.path === path && l.route.methods[method])?.route.stack.map((s: any) => s.handle) ?? [];
  const routerLevel = (router: any) => router.stack.filter((l: any) => !l.route).map((l: any) => l.handle);

  it.each(['kpi', 'approvals', 'explainability', 'orchestrator'])('%s router is admin only', name => {
    expect(routerLevel(require(`../routes/${name}`).default)).toContain(requireAdmin);
  });

  it('all-business agent triggers are admin only; the per-business trigger checks ownership', () => {
    const r = require('../routes/agentTrigger').default;
    for (const p of ['/discover-competitor-urls', '/enrich-competitor-urls', '/collect-reviews']) {
      expect(routeHandlers(r, 'post', p)).toContain(requireAdmin);
    }
    expect(routeHandlers(r, 'post', '/')).toContain(requireOwnsBusinessFields);
  });

  it.each(['social', 'competitors', 'feedback', 'meta/auth'])('%s router checks business ids on every route', name => {
    expect(routerLevel(require(`../routes/${name}`).default)).toContain(requireOwnsBusinessFields);
  });

  it('social comment and review routes resolve the row\'s owner first', () => {
    const r = require('../routes/social').default;
    for (const [m, p] of [['post', '/comments/:id/reply'], ['delete', '/comments/:id'], ['patch', '/comments/:id/dismiss'], ['post', '/reviews/:id/suggest-reply']]) {
      expect(routeHandlers(r, m, p).length).toBeGreaterThan(1);
    }
  });
});
