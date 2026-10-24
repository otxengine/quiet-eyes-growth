/**
 * IDOR fix: POST /api/functions/:name must not let a caller read/act on a
 * businessProfileId they don't own. Guarded by requireBusinessAccess
 * (server/src/middleware/businessAccess.ts), wired in front of the
 * FUNCTION_MAP dispatch in server/src/routes/functions/index.ts.
 */
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn(() => []), findUnique: jest.fn(() => null) },
    $queryRawUnsafe: jest.fn(() => Promise.resolve([])),
    competitor: { findMany: jest.fn() },
    proactiveAlert: { findMany: jest.fn() },
  },
}));

jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn(() => Promise.resolve({ ok: true })) }));

jest.mock('../middleware/auth', () => ({
  getUserId: jest.fn(),
  isAdminKeyRequest: jest.fn(),
}));

jest.mock('../lib/ownership', () => ({
  getUserBusinessIds: jest.fn(),
  getUserEmail: jest.fn(),
}));

import { Request, Response } from 'express';
import { getUserId, isAdminKeyRequest } from '../middleware/auth';
import { getUserBusinessIds } from '../lib/ownership';

let router: any;
beforeAll(() => {
  router = require('../routes/functions').default;
});

function makeReq(body: object): Request {
  // A function name that doesn't exist in FUNCTION_MAP — lets requests that
  // pass the access check reach the real dispatch logic (→ 404) without
  // invoking any real handler's business logic.
  return { body, params: { name: '__nonexistent_fn__' }, headers: {} } as unknown as Request;
}

function makeRes() {
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
  return { res, json };
}

async function dispatch(req: Request, res: Response) {
  const layer = router.stack.find(
    (l: any) => l.route?.path === '/:name' && l.route?.methods?.post,
  );
  const handlers = layer.route.stack.map((s: any) => s.handle);
  let i = 0;
  const next = async (err?: any) => {
    if (err) throw err;
    const h = handlers[i++];
    if (h) await h(req, res, next);
  };
  await next();
}

describe('POST /api/functions/:name — requireBusinessAccess', () => {
  it('401s when there is no authenticated user', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue(null);

    const { res } = makeRes();
    await dispatch(makeReq({ businessProfileId: 'biz-1' }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getUserBusinessIds).not.toHaveBeenCalled();
  });

  it('403s when businessProfileId is not in the caller\'s owned set', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue('user-a');
    (getUserBusinessIds as jest.Mock).mockResolvedValue(['biz-owned-by-a']);

    const { res } = makeRes();
    await dispatch(makeReq({ businessProfileId: 'biz-owned-by-b' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('reaches dispatch when businessProfileId is owned (unknown fn -> 404, not 401/403)', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue('user-a');
    (getUserBusinessIds as jest.Mock).mockResolvedValue(['biz-1']);

    const { res } = makeRes();
    await dispatch(makeReq({ businessProfileId: 'biz-1' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('reaches dispatch when the body has no businessProfileId (ownership check skipped)', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue('user-a');

    const { res } = makeRes();
    await dispatch(makeReq({}), res);

    expect(getUserBusinessIds).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('bypasses the check entirely with a valid admin key', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(true);

    const { res } = makeRes();
    await dispatch(makeReq({ businessProfileId: 'someone-elses-business' }), res);

    expect(getUserId).not.toHaveBeenCalled();
    expect(getUserBusinessIds).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

/**
 * requireFunctionAccess: ids other than businessProfileId (competitorId, leadId, postId,
 * entityId, linked_business, ...) must belong to the caller too. Before, e.g. revisePost
 * {postId} rewrote any tenant's post and generateBattlecard {competitorId} used the
 * victim's business.
 */
describe('POST /api/functions/:name — requireFunctionAccess', () => {
  const { prisma } = require('../db');
  const named = (name: string, body: object) =>
    ({ body, params: { name }, headers: {} }) as unknown as Request;
  const errorOf = (json: jest.Mock) => json.mock.calls[0]?.[0]?.error;

  beforeEach(() => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue('user-a');
    (getUserBusinessIds as jest.Mock).mockResolvedValue(['biz-a']);
  });

  it('404s another tenant\'s competitorId before any handler runs', async () => {
    prisma.competitor.findMany.mockResolvedValue([{ linked_business: 'biz-b' }]);
    const { res, json } = makeRes();
    await dispatch(makeReq({ competitorId: 'comp-of-b' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(errorOf(json)).toBe('Not found');
  });

  it('lets own competitorIds through, but one foreign id in the list is enough to refuse', async () => {
    prisma.competitor.findMany.mockResolvedValue([{ linked_business: 'biz-a' }]);
    let r = makeRes();
    await dispatch(makeReq({ competitorIds: ['c1'] }), r.res);
    expect(errorOf(r.json)).toMatch(/Unknown function/);

    prisma.competitor.findMany.mockResolvedValue([{ linked_business: 'biz-a' }, { linked_business: 'biz-b' }]);
    r = makeRes();
    await dispatch(makeReq({ competitorIds: ['c1', 'c2'] }), r.res);
    expect(errorOf(r.json)).toBe('Not found');
  });

  it('looks up entityId in the table its entityType names, and ignores types without one', async () => {
    prisma.proactiveAlert.findMany.mockResolvedValue([{ linked_business: 'biz-b' }]);
    let r = makeRes();
    await dispatch(makeReq({ entityType: 'alert', entityId: 'alert-of-b' }), r.res);
    expect(errorOf(r.json)).toBe('Not found');

    r = makeRes();
    await dispatch(makeReq({ entityType: 'event', entityId: 'evt-1' }), r.res);
    expect(errorOf(r.json)).toMatch(/Unknown function/);
  });

  it('403s a business id passed under another name (logOutcome, submitSupportTicket)', async () => {
    let r = makeRes();
    await dispatch(makeReq({ linked_business: 'biz-b' }), r.res);
    expect(r.res.status).toHaveBeenCalledWith(403);
    r = makeRes();
    await dispatch(makeReq({ businessId: 'biz-b' }), r.res);
    expect(r.res.status).toHaveBeenCalledWith(403);
  });

  it('checks ?businessProfileId= too (getEventBusStats/manageConstraints fall back to it)', async () => {
    const { res } = makeRes();
    await dispatch({ body: {}, query: { businessProfileId: 'biz-b' }, params: { name: 'manageConstraints' }, headers: {} } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('400s non-string ids so Prisma operators can\'t be smuggled in', async () => {
    const { res } = makeRes();
    await dispatch(makeReq({ competitorId: { not: 'x' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('requires a businessProfileId for functions that would otherwise run for every business', async () => {
    const { res, json } = makeRes();
    await dispatch(named('runFullScan', {}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(errorOf(json)).toBe('businessProfileId required');
  });

  it('skips the checks for the admin key', async () => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(true);
    prisma.competitor.findMany.mockResolvedValue([{ linked_business: 'biz-b' }]);
    const { res, json } = makeRes();
    await dispatch(makeReq({ competitorId: 'comp-of-b' }), res);
    expect(errorOf(json)).toMatch(/Unknown function/);
  });
});

describe('invokeLLM — limits for signed-in users', () => {
  const { invokeLLM } = require('../lib/llm');
  const llmReq = (body: object) => ({ body, params: { name: 'invokeLLM' }, headers: {} }) as unknown as Request;

  beforeEach(() => {
    (isAdminKeyRequest as jest.Mock).mockReturnValue(false);
    (getUserId as jest.Mock).mockReturnValue('user-a');
    (invokeLLM as jest.Mock).mockClear();
  });

  it('refuses models other than haiku/sonnet (unknown keys reach OpenRouter as raw model ids)', async () => {
    const { res } = makeRes();
    await dispatch(llmReq({ prompt: 'x', model: 'openai/o1-pro' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it('caps maxTokens', async () => {
    const { res } = makeRes();
    await dispatch(llmReq({ prompt: 'x', model: 'sonnet', maxTokens: 100000 }), res);
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ model: 'sonnet', maxTokens: 1500 }));
  });
});
