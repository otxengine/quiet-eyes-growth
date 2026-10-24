/**
 * OAuth tokens at rest:
 *  - lib/crypto pins a 16-byte GCM tag and never falls back to plaintext.
 *  - WhatsApp Embedded Signup stores its token encrypted, and the sender decrypts it.
 *  - encryptStoredTokens encrypts leftover plaintext values once and is safe to re-run.
 */
import { randomBytes } from 'crypto';
process.env.META_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.META_APP_ID = 'app';
process.env.META_APP_SECRET = 'secret';

jest.mock('../db', () => ({
  prisma: {
    metaConnection:  { findUnique: jest.fn(), upsert: jest.fn() },
    businessProfile: { updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    socialAccount:   { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    aIAgentConfig:   { findFirst: jest.fn(), create: jest.fn() },
    pendingAlert:    { create: jest.fn() },
  },
}));
jest.mock('../lib/metaApi', () => ({
  metaApi: { getLongLivedToken: jest.fn(), subscribeToWABA: jest.fn() },
}));
jest.mock('../middleware/businessAccess', () => ({
  requireOwnsBusinessFields: (_req: any, _res: any, next: any) => next(),
  ownsBusinessParam: (_req: any, _res: any, next: any) => next(),
  requireOwnsBusiness: () => (_req: any, _res: any, next: any) => next(),
  requireOwnsRecord: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../db';
import { metaApi } from '../lib/metaApi';
import { encryptToken, decryptToken, tryDecryptToken, tryEncryptToken, isEncryptedToken } from '../lib/crypto';
import { encryptStoredTokens } from '../scripts/encryptStoredTokens';
import { sendWhatsApp } from '../services/execution/WhatsAppExecutor';
import metaAuthRouter from '../routes/meta/auth';

const db = prisma as any;
beforeEach(() => jest.clearAllMocks());

describe('lib/crypto', () => {
  test('round-trips and refuses a truncated auth tag', () => {
    const stored = encryptToken('EAAtoken');
    expect(decryptToken(stored)).toBe('EAAtoken');
    const [iv, tag, ct] = stored.split(':');
    expect(() => decryptToken(`${iv}:${tag.slice(0, 8)}:${ct}`)).toThrow();
  });

  test('the try* helpers never pass plaintext through', () => {
    expect(() => tryDecryptToken('EAAplaintext')).toThrow();
    expect(tryDecryptToken('')).toBe('');
    const key = process.env.META_ENCRYPTION_KEY;
    delete process.env.META_ENCRYPTION_KEY;
    try {
      expect(() => tryEncryptToken('EAAtoken')).toThrow();
    } finally {
      process.env.META_ENCRYPTION_KEY = key;
    }
  });
});

describe('WhatsApp token', () => {
  test('Embedded Signup stores the token encrypted on the profile and the social account', async () => {
    (metaApi.getLongLivedToken as jest.Mock).mockResolvedValue({ token: 'EAAlong', expiresIn: 3600 });
    db.metaConnection.findUnique.mockResolvedValue(null);
    db.metaConnection.upsert.mockResolvedValue({ id: 'conn_1' });
    db.businessProfile.updateMany.mockResolvedValue({ count: 1 });
    db.socialAccount.findFirst.mockResolvedValue(null);
    db.aIAgentConfig.findFirst.mockResolvedValue({ id: 'cfg_1' });

    // The number has to be in the WABA the token can read (meta/auth.ts wabaHasPhoneNumber)
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'p1' }] }) }) as any;
    (metaApi.subscribeToWABA as jest.Mock).mockResolvedValue(undefined);

    const layer = (metaAuthRouter as any).stack.find((l: any) => l.route?.path === '/whatsapp/embedded-signup');
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await layer.route.stack[0].handle({ body: { code: 'EAAshort', businessProfileId: 'biz_1', waba_id: '999', phone_number_id: 'p1' } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const profileToken = db.businessProfile.updateMany.mock.calls[0][0].data.whatsapp_access_token;
    const accountToken = db.socialAccount.create.mock.calls[0][0].data.access_token;
    for (const stored of [profileToken, accountToken]) {
      expect(isEncryptedToken(stored)).toBe(true);
      expect(decryptToken(stored)).toBe('EAAlong');
    }
  });

  test('the sender decrypts the stored token', async () => {
    db.businessProfile.findUnique.mockResolvedValue({ whatsapp_phone_number_id: 'p1', whatsapp_access_token: encryptToken('EAAlong') });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'm1' }] }) });
    global.fetch = fetchMock as any;

    expect(await sendWhatsApp('biz_1', { to: '050-1234567', text: 'hi' })).toEqual({ sent: true, method: 'api', messageId: 'm1' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer EAAlong');
  });
});

describe('encryptStoredTokens backfill', () => {
  test('encrypts only plaintext values, guarded on the value it read', async () => {
    const already = encryptToken('old');
    db.socialAccount.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve('access_token' in where ? [{ id: 's1', access_token: 'EAAplain' }, { id: 's2', access_token: already }] : []));
    db.businessProfile.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve('google_access_token' in where ? [{ id: 'b1', google_access_token: 'ya29.plain' }] : []));
    db.socialAccount.updateMany.mockResolvedValue({ count: 1 });
    db.businessProfile.updateMany.mockResolvedValue({ count: 1 });

    expect(await encryptStoredTokens()).toBe(2);

    const [saCall] = db.socialAccount.updateMany.mock.calls;
    expect(db.socialAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(saCall[0].where).toEqual({ id: 's1', access_token: 'EAAplain' });
    expect(decryptToken(saCall[0].data.access_token)).toBe('EAAplain');
    const [bpCall] = db.businessProfile.updateMany.mock.calls;
    expect(bpCall[0].where).toEqual({ id: 'b1', google_access_token: 'ya29.plain' });
    expect(decryptToken(bpCall[0].data.google_access_token)).toBe('ya29.plain');
  });

  test('a second run over encrypted rows writes nothing', async () => {
    db.socialAccount.findMany.mockResolvedValue([{ id: 's1', access_token: encryptToken('a'), refresh_token: encryptToken('r') }]);
    db.businessProfile.findMany.mockResolvedValue([]);

    expect(await encryptStoredTokens()).toBe(0);
    expect(db.socialAccount.updateMany).not.toHaveBeenCalled();
  });
});
