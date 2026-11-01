/**
 * getUserEmail trusts only the verified primary Clerk address, and the
 * getUserBusinessIds email fallback claims matched profiles for the Clerk id.
 */

const mockGetUser = jest.fn();
jest.mock('@clerk/express', () => ({ createClerkClient: () => ({ users: { getUser: mockGetUser } }) }));
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn(), updateMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

import { prisma } from '../db';
import { getUserEmail, getUserBusinessIds } from '../lib/ownership';

const findMany   = prisma.businessProfile.findMany as jest.Mock;
const updateMany = prisma.businessProfile.updateMany as jest.Mock;
const queryRaw   = prisma.$queryRawUnsafe as jest.Mock;

const addr = (id: string, emailAddress: string, status: string | null) =>
  ({ id, emailAddress, verification: status ? { status } : null });

// getUserEmail caches per userId, so every test uses its own id.
let n = 0;
const nextUserId = () => `user_test_${++n}`;

beforeAll(() => { process.env.CLERK_SECRET_KEY = 'sk_test_dummy'; });
beforeEach(() => {
  queryRaw.mockResolvedValue([]);
  updateMany.mockResolvedValue({ count: 0 });
});

describe('getUserEmail', () => {
  test('returns the verified primary address', async () => {
    mockGetUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [addr('idn_1', 'owner@example.com', 'verified')],
    });
    expect(await getUserEmail(nextUserId())).toBe('owner@example.com');
  });

  test('null when the primary address is unverified', async () => {
    mockGetUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [addr('idn_1', 'victim@example.com', null)],
    });
    expect(await getUserEmail(nextUserId())).toBeNull();

    mockGetUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [addr('idn_1', 'victim@example.com', 'unverified')],
    });
    expect(await getUserEmail(nextUserId())).toBeNull();
  });

  test('ignores a non-primary first address and uses the verified primary', async () => {
    mockGetUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_2',
      emailAddresses: [addr('idn_1', 'victim@example.com', null), addr('idn_2', 'attacker@example.com', 'verified')],
    });
    expect(await getUserEmail(nextUserId())).toBe('attacker@example.com');
  });

  test('a verified non-primary address does not stand in for an unverified primary', async () => {
    mockGetUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_2',
      emailAddresses: [addr('idn_1', 'other@example.com', 'verified'), addr('idn_2', 'victim@example.com', null)],
    });
    expect(await getUserEmail(nextUserId())).toBeNull();
  });

  test('caches a null result instead of calling Clerk on every check', async () => {
    const userId = nextUserId();
    mockGetUser.mockResolvedValue({ primaryEmailAddressId: 'idn_1', emailAddresses: [addr('idn_1', 'v@example.com', null)] });
    await getUserEmail(userId);
    await getUserEmail(userId);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  test('null (and not cached) when Clerk errors', async () => {
    const userId = nextUserId();
    mockGetUser.mockRejectedValueOnce(new Error('clerk down'));
    expect(await getUserEmail(userId)).toBeNull();
    mockGetUser.mockResolvedValue({ primaryEmailAddressId: 'idn_1', emailAddresses: [addr('idn_1', 'ok@example.com', 'verified')] });
    expect(await getUserEmail(userId)).toBe('ok@example.com');
  });
});

describe('getUserBusinessIds email fallback', () => {
  test('unverified primary gets no email-matched profiles', async () => {
    mockGetUser.mockResolvedValue({ primaryEmailAddressId: 'idn_1', emailAddresses: [addr('idn_1', 'victim@example.com', null)] });
    findMany.mockResolvedValueOnce([]); // by Clerk id
    expect(await getUserBusinessIds(nextUserId())).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('verified primary gets the admin-created profile and claims it for the Clerk id', async () => {
    const userId = nextUserId();
    mockGetUser.mockResolvedValue({ primaryEmailAddressId: 'idn_1', emailAddresses: [addr('idn_1', 'owner@example.com', 'verified')] });
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'biz-admin' }]);
    expect(await getUserBusinessIds(userId)).toEqual(['biz-admin']);
    expect(findMany).toHaveBeenLastCalledWith({ where: { created_by: 'owner@example.com' }, select: { id: true } });
    expect(updateMany).toHaveBeenCalledWith({ where: { created_by: 'owner@example.com' }, data: { created_by: userId } });
  });

  test('a failed claim still grants access for this request', async () => {
    mockGetUser.mockResolvedValue({ primaryEmailAddressId: 'idn_1', emailAddresses: [addr('idn_1', 'owner@example.com', 'verified')] });
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'biz-admin' }]);
    updateMany.mockRejectedValueOnce(new Error('db busy'));
    expect(await getUserBusinessIds(nextUserId())).toEqual(['biz-admin']);
  });

  test('no Clerk lookup or claim when the user already owns a profile by id', async () => {
    findMany.mockResolvedValueOnce([{ id: 'biz-own' }]);
    expect(await getUserBusinessIds(nextUserId())).toEqual(['biz-own']);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
