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
  },
}));

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
