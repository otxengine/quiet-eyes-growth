/**
 * Reactivation endpoints — email-matched candidate lookup + guarded reclaim.
 */

jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() },
}));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn() }));
jest.mock('../lib/ownership', () => ({ getUserEmail: jest.fn() }));

import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { getUserEmail } from '../lib/ownership';
import { getCandidatesHandler, reactivateHandler } from '../routes/reactivation';

const queryRawUnsafe   = prisma.$queryRawUnsafe as jest.Mock;
const executeRawUnsafe = prisma.$executeRawUnsafe as jest.Mock;
const mockGetUserId    = getUserId as jest.Mock;
const mockGetUserEmail = getUserEmail as jest.Mock;

function makeReqRes(params: any = {}) {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  const req: any = { params };
  const res: any = { json, status };
  return { req, res, json, status };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/reactivation/candidates', () => {
  test('401 when unauthenticated', async () => {
    mockGetUserId.mockReturnValue(null);
    const { req, res, status, json } = makeReqRes();
    await getCandidatesHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  test('returns [] when the user has no resolvable email, without querying the DB', async () => {
    mockGetUserId.mockReturnValue('u1');
    mockGetUserEmail.mockResolvedValue(null);
    const { req, res, json } = makeReqRes();
    await getCandidatesHandler(req, res);
    expect(json).toHaveBeenCalledWith([]);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  test('returns deactivated profiles matching the resolved email, multiple allowed', async () => {
    mockGetUserId.mockReturnValue('u1');
    mockGetUserEmail.mockResolvedValue('owner@example.com');
    const rows = [{ id: 'bp1', name: 'A' }, { id: 'bp2', name: 'B' }];
    queryRawUnsafe.mockResolvedValue(rows);

    const { req, res, json } = makeReqRes();
    await getCandidatesHandler(req, res);

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('is_active = false'), 'owner@example.com',
    );
    expect(json).toHaveBeenCalledWith(rows);
  });
});

describe('POST /api/reactivation/:businessProfileId/reactivate', () => {
  test('401 when unauthenticated', async () => {
    mockGetUserId.mockReturnValue(null);
    const { req, res, status } = makeReqRes({ businessProfileId: 'bp1' });
    await reactivateHandler(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  test('404 when the profile does not exist', async () => {
    mockGetUserId.mockReturnValue('u1');
    mockGetUserEmail.mockResolvedValue('owner@example.com');
    queryRawUnsafe.mockResolvedValue([]);

    const { req, res, status, json } = makeReqRes({ businessProfileId: 'missing' });
    await reactivateHandler(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('404 (same shape as not-found) when owner_email does not match — no ID enumeration', async () => {
    mockGetUserId.mockReturnValue('u1');
    mockGetUserEmail.mockResolvedValue('attacker@example.com');
    queryRawUnsafe.mockResolvedValue([{ id: 'bp1', owner_email: 'realowner@example.com' }]);

    const { req, res, status, json } = makeReqRes({ businessProfileId: 'bp1' });
    await reactivateHandler(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('success: reassigns created_by to the new user and reactivates, case-insensitively', async () => {
    mockGetUserId.mockReturnValue('newUser1');
    mockGetUserEmail.mockResolvedValue('Owner@Example.com');
    queryRawUnsafe.mockResolvedValue([{ id: 'bp1', owner_email: 'owner@example.com' }]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await reactivateHandler(req, res);

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SET is_active = true'), 'newUser1', 'bp1',
    );
    expect(json).toHaveBeenCalledWith({ ok: true });
  });

  test('success path never touches organizations/organization_members', async () => {
    mockGetUserId.mockReturnValue('newUser1');
    mockGetUserEmail.mockResolvedValue('owner@example.com');
    queryRawUnsafe.mockResolvedValue([{ id: 'bp1', owner_email: 'owner@example.com' }]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await reactivateHandler(req, res);

    const orgWrites = executeRawUnsafe.mock.calls.filter(
      ([sql]: [string]) => /organizations|organization_members/i.test(sql),
    );
    expect(orgWrites).toHaveLength(0);
  });
});
