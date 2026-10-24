/**
 * googleTokenRefresh — a dead refresh token (invalid_grant) flags the account for reconnect
 * instead of being retried every 30 minutes forever; transient failures leave it alone.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

jest.mock('../db', () => ({
  prisma: {
    socialAccount:   { findFirst: jest.fn(), update: jest.fn() },
    businessProfile: { updateMany: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../lib/crypto', () => ({
  tryDecryptToken: (v: string) => v,
  tryEncryptToken: (v: string) => v,
}));

import { refreshGoogleToken } from '../lib/googleTokenRefresh';
import { prisma } from '../db';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  (prisma.socialAccount.findFirst as jest.Mock).mockResolvedValue({ id: 'sa1', refresh_token: 'rt' });
});

test('invalid_grant disconnects the account and records why', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) });
  await expect(refreshGoogleToken('biz1')).resolves.toBeNull();
  expect(prisma.socialAccount.update).toHaveBeenCalledWith({
    where: { id: 'sa1' },
    data:  { is_connected: false, access_token: null, refresh_token: null, last_error: 'google_invalid_grant' },
  });
  expect(prisma.businessProfile.updateMany).toHaveBeenCalledWith({ where: { id: 'biz1' }, data: { google_access_token: null } });
});

test('a transient failure keeps the account connected for the next retry', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
  await expect(refreshGoogleToken('biz1')).resolves.toBeNull();
  expect(prisma.socialAccount.update).not.toHaveBeenCalled();
});
