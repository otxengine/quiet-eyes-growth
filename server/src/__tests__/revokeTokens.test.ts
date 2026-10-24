/**
 * L6: disconnecting revokes the Google / Meta token with the provider and deletes every stored
 * copy; deleting a user (Clerk webhook, admin delete) does the same for their businesses.
 */
jest.mock('../db', () => ({
  prisma: {
    socialAccount:   { findMany: jest.fn(), updateMany: jest.fn() },
    metaConnection:  { findMany: jest.fn(), updateMany: jest.fn() },
    businessProfile: { updateMany: jest.fn() },
  },
}));
jest.mock('../lib/crypto', () => ({ tryDecryptToken: (v: string) => v.replace(/^enc:/, '') }));

import { prisma } from '../db';
import { disconnectIntegrations } from '../lib/revokeTokens';

const accounts    = prisma.socialAccount.findMany as jest.Mock;
const connections = prisma.metaConnection.findMany as jest.Mock;
const fetchMock   = jest.fn();
const origFetch   = global.fetch;
const OLD_ENV     = process.env;
const urls = () => fetchMock.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  process.env = { ...OLD_ENV, FACEBOOK_APP_ID: 'app', FACEBOOK_APP_SECRET: 'sec' };
  accounts.mockResolvedValue([]);
  connections.mockResolvedValue([]);
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true, json: async () => (String(url).includes('debug_token') ? { data: { user_id: 'fbuser' } } : { success: true }),
  }));
  global.fetch = fetchMock as any;
});
afterAll(() => { process.env = OLD_ENV; global.fetch = origFetch; });

test('Google: revokes the refresh token (in the POST body, not the URL), then deletes it', async () => {
  accounts.mockResolvedValue([{ platform: 'google_business', access_token: 'enc:at', refresh_token: 'enc:rt' }]);
  await disconnectIntegrations(['biz-1'], 'google_business');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://oauth2.googleapis.com/revoke');
  expect(init).toMatchObject({ method: 'POST', body: 'token=rt' });
  expect(prisma.socialAccount.updateMany).toHaveBeenCalledWith({
    where: { linked_business: { in: ['biz-1'] }, platform: 'google_business' },
    data: { is_connected: false, access_token: null, refresh_token: null, last_error: null },
  });
  expect(prisma.businessProfile.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['biz-1'] } }, data: { google_access_token: null } });
  expect(connections).not.toHaveBeenCalled();
});

test('Meta: looks up who granted the token and revokes only this integration\'s permissions', async () => {
  accounts.mockResolvedValue([{ platform: 'instagram_business', access_token: 'enc:page-tok', refresh_token: null }]);
  await disconnectIntegrations(['biz-1'], 'instagram_business');

  expect(urls()[0]).toContain('/debug_token?input_token=page-tok&access_token=app%7Csec');
  const deletes = fetchMock.mock.calls.filter(c => c[1]?.method === 'DELETE').map(c => String(c[0]));
  expect(deletes.map(u => u.split('?')[0])).toEqual([
    'https://graph.facebook.com/v19.0/fbuser/permissions/instagram_content_publish',
    'https://graph.facebook.com/v19.0/fbuser/permissions/instagram_basic',
  ]);
  expect(urls().some(u => u.includes('pages_show_list'))).toBe(false); // shared with the Facebook integration
  expect(prisma.businessProfile.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['biz-1'] } }, data: { instagram_access_token: null, instagram_page_id: null },
  });
});

test('WhatsApp: the token in SocialAccount and MetaConnection is revoked once, and both copies are wiped', async () => {
  accounts.mockResolvedValue([{ platform: 'whatsapp_business', access_token: 'wa-tok', refresh_token: null }]);
  connections.mockResolvedValue([{ platform: 'whatsapp', encrypted_token: 'enc:wa-tok' }]);
  await disconnectIntegrations(['biz-1'], 'whatsapp_business');

  expect(urls().filter(u => u.includes('debug_token'))).toHaveLength(1);
  expect(connections).toHaveBeenCalledWith(expect.objectContaining({ where: { business_profile_id: { in: ['biz-1'] }, platform: 'whatsapp' } }));
  expect(prisma.metaConnection.updateMany).toHaveBeenCalledWith({
    where: { business_profile_id: { in: ['biz-1'] }, platform: 'whatsapp' }, data: { is_active: false, encrypted_token: '' },
  });
});

test('a provider outage never keeps the token in our DB', async () => {
  accounts.mockResolvedValue([{ platform: 'meta_ads', access_token: 'enc:t', refresh_token: null }]);
  fetchMock.mockRejectedValue(new Error('ECONNRESET'));
  await disconnectIntegrations(['biz-1'], 'meta_ads');
  expect(prisma.socialAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ access_token: null }) }));
});

test('no platform (user deletion): every integration, every MetaConnection, every mirror field', async () => {
  accounts.mockResolvedValue([{ platform: 'google_ads', access_token: 'g', refresh_token: 'grt' }]);
  connections.mockResolvedValue([{ platform: 'messenger', encrypted_token: 'enc:m' }]);
  await disconnectIntegrations(['biz-1', 'biz-2']);

  expect(prisma.socialAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { linked_business: { in: ['biz-1', 'biz-2'] } } }));
  expect(prisma.metaConnection.updateMany).toHaveBeenCalledWith({
    where: { business_profile_id: { in: ['biz-1', 'biz-2'] } }, data: { is_active: false, encrypted_token: '' },
  });
  expect(Object.keys((prisma.businessProfile.updateMany as jest.Mock).mock.calls[0][0].data).sort()).toEqual([
    'facebook_page_id', 'facebook_page_token', 'google_access_token', 'instagram_access_token',
    'instagram_page_id', 'whatsapp_access_token', 'whatsapp_phone_number_id',
  ]);
  expect(urls()).toContain('https://oauth2.googleapis.com/revoke');
  expect(urls().some(u => u.includes('/permissions/pages_messaging'))).toBe(true);
});

test('no businesses: nothing to do', async () => {
  await disconnectIntegrations([]);
  expect(accounts).not.toHaveBeenCalled();
});

describe('callers', () => {
  test('meta/auth DELETE /connections/:id revokes a Messenger token and blanks it', async () => {
    jest.resetModules();
    const revokeToken = jest.fn();
    const disconnect = jest.fn();
    const db = { metaConnection: { findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../db', () => ({ prisma: db }));
    jest.doMock('../lib/revokeTokens', () => ({ revokeToken, disconnectIntegrations: disconnect, metaIntegration: (p: string) => (p === 'whatsapp' ? 'whatsapp_business' : 'messenger') }));
    jest.doMock('../middleware/businessAccess', () => ({
      requireOwnsBusinessFields: jest.fn(), ownsBusinessParam: jest.fn(), requireOwnsRecord: () => jest.fn(), requireOwnsBusiness: () => jest.fn(),
    }));
    const router = require('../routes/meta/auth').default;
    const layer = router.stack.find((l: any) => l.route?.path === '/connections/:id' && l.route.methods.delete);
    const del = layer.route.stack[layer.route.stack.length - 1].handle;
    const res: any = { json: jest.fn(), status: jest.fn(() => res) };

    db.metaConnection.findUnique.mockResolvedValueOnce({ platform: 'messenger', business_profile_id: 'biz-1', encrypted_token: 'enc:m' });
    await del({ params: { id: 'mc1' } }, res);
    expect(revokeToken).toHaveBeenCalledWith('messenger', 'enc:m');
    expect(db.metaConnection.update).toHaveBeenCalledWith({ where: { id: 'mc1' }, data: { is_active: false, encrypted_token: '' } });

    db.metaConnection.findUnique.mockResolvedValueOnce({ platform: 'whatsapp', business_profile_id: 'biz-1', encrypted_token: 'enc:w' });
    await del({ params: { id: 'mc2' } }, res);
    expect(disconnect).toHaveBeenCalledWith(['biz-1'], 'whatsapp_business');
  });

  test('admin user delete clears the business\'s tokens before deleting its rows', async () => {
    jest.resetModules();
    const disconnect = jest.fn();
    const db = {
      businessProfile: { findUnique: jest.fn(async () => ({ id: 'biz-1', created_by: 'user_1' })), delete: jest.fn() },
      $executeRawUnsafe: jest.fn(async () => 0),
    };
    jest.doMock('../db', () => ({ prisma: db }));
    jest.doMock('../lib/revokeTokens', () => ({ disconnectIntegrations: disconnect }));
    jest.doMock('../middleware/auth', () => ({ isAdminKeyRequest: () => true }));
    process.env.CLERK_SECRET_KEY = '';
    const router = require('../routes/adminUsers').default;
    const layer = router.stack.find((l: any) => l.route?.path === '/users/:businessId' && l.route.methods.delete);
    const res: any = { json: jest.fn(), status: jest.fn(() => res) };
    await layer.route.stack[0].handle({ params: { businessId: 'biz-1' }, headers: {} }, res);

    expect(disconnect).toHaveBeenCalledWith(['biz-1']);
    const firstDelete = db.$executeRawUnsafe.mock.invocationCallOrder[0];
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(firstDelete);
  });
});
