/**
 * /api deny-by-default gate (middleware/apiAuth.ts) and the tenant guards in
 * middleware/businessAccess.ts, plus their wiring on the routers that were
 * reachable without a signed-in user (confirmed on staging 2026-10-24:
 * GET /api/social/snapshot/profile answered 200 with no token).
 */
jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(), isAdminKeyRequest: jest.fn() }));
jest.mock('../lib/ownership', () => ({ getUserBusinessIds: jest.fn(), getUserEmail: jest.fn() }));

import { Request, Response } from 'express';
import { getUserId, isAdminKeyRequest } from '../middleware/auth';
import { getUserBusinessIds } from '../lib/ownership';
import { requireApiAuth } from '../middleware/apiAuth';
import {
  requireOwnsBusinessFields, ownsBusinessParam, requireOwnsRecord, requireAdminKey,
} from '../middleware/businessAccess';

const asUser = (id: string | null, owned: string[] = []) => {
  (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
  (getUserId as jest.Mock).mockReturnValue(id);
  (getUserBusinessIds as jest.Mock).mockResolvedValue(owned);
};
const asAdmin = () => {
  (isAdminKeyRequest as jest.Mock).mockReturnValue(true);
  (getUserId as jest.Mock).mockReturnValue(null);
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

  it('lets a signed-in user or the admin key through', async () => {
    asUser('user-a');
    expect((await run(requireApiAuth, req({ path: '/kpi/biz-1' }))).next).toHaveBeenCalled();
    asAdmin();
    expect((await run(requireApiAuth, req({ path: '/kpi/biz-1' }))).next).toHaveBeenCalled();
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

  it('401s an id without a user, and lets the admin key act on any business', async () => {
    asUser(null);
    expect((await run(requireOwnsBusinessFields, req({ query: { businessId: 'biz-b' } }))).status).toBe(401);
    asAdmin();
    expect((await run(requireOwnsBusinessFields, req({ query: { businessId: 'biz-b' } }))).next).toHaveBeenCalled();
  });
});

describe('ownsBusinessParam / requireOwnsRecord / requireAdminKey', () => {
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

  it('requireAdminKey 403s signed-in users', async () => {
    asUser('user-a', ['biz-a']);
    expect((await run(requireAdminKey, req({}))).status).toBe(403);
    asAdmin();
    expect((await run(requireAdminKey, req({}))).next).toHaveBeenCalled();
  });
});

describe('router wiring', () => {
  const routeHandlers = (router: any, method: string, path: string) =>
    router.stack.find((l: any) => l.route?.path === path && l.route.methods[method])?.route.stack.map((s: any) => s.handle) ?? [];
  const routerLevel = (router: any) => router.stack.filter((l: any) => !l.route).map((l: any) => l.handle);

  it.each(['kpi', 'approvals', 'explainability', 'orchestrator'])('%s router is admin-key only', name => {
    expect(routerLevel(require(`../routes/${name}`).default)).toContain(requireAdminKey);
  });

  it('all-business agent triggers are admin-key only; the per-business trigger checks ownership', () => {
    const r = require('../routes/agentTrigger').default;
    for (const p of ['/discover-competitor-urls', '/enrich-competitor-urls', '/collect-reviews']) {
      expect(routeHandlers(r, 'post', p)).toContain(requireAdminKey);
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
