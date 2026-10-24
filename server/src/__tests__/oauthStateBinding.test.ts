/**
 * OAuth state is bound to the signed-in user + business, single use, short-lived (M7); the API no
 * longer renders popup HTML or posts to '*': the callback redirects to the app's own page, which
 * finishes the flow over authenticated JSON (L14); WhatsApp's phone_number_id must be in a WABA the
 * token can read (L5).
 */
jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe:   jest.fn(),
    socialAccount:     { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    businessProfile:   { updateMany: jest.fn() },
    metaConnection:    { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    aIAgentConfig:     { findFirst: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/crypto', () => ({ tryEncryptToken: (v: string) => `enc:${v}`, encryptToken: (v: string) => `enc:${v}` }));
jest.mock('../lib/ownership', () => ({ getUserBusinessIds: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  getUserId: jest.fn(), isAdminKeyRequest: jest.fn(() => false),
  frontendOrigins: jest.requireActual('../middleware/auth').frontendOrigins,
}));
jest.mock('../lib/revokeTokens', () => ({ disconnectIntegrations: jest.fn(), revokeToken: jest.fn(), metaIntegration: jest.fn() }));
jest.mock('../lib/metaApi', () => ({
  metaApi: { getLongLivedToken: jest.fn(async () => ({ token: 'long-tok', expiresIn: 3600 })), subscribeToWABA: jest.fn(async () => {}) },
}));

import { prisma } from '../db';
import { getUserBusinessIds } from '../lib/ownership';
import { getUserId } from '../middleware/auth';
import { disconnectIntegrations } from '../lib/revokeTokens';
import oauthRouter from '../routes/oauth';
import metaAuthRouter, { wabaHasPhoneNumber } from '../routes/meta/auth';

const execRaw  = prisma.$executeRawUnsafe as jest.Mock;
const queryRaw = prisma.$queryRawUnsafe as jest.Mock;
const asUser = (id: string | null, owned: string[] = ['biz-1']) => {
  (getUserId as jest.Mock).mockReturnValue(id);
  (getUserBusinessIds as jest.Mock).mockResolvedValue(owned);
};

// The route's own handler (last in its stack); ownership middleware is covered in apiAuth.test.ts
const handler = (router: any, method: string, path: string) => {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
function call(h: any, r: Record<string, any>) {
  const res: any = {};
  res.status   = jest.fn(() => res);
  res.json     = jest.fn(() => res);
  res.send     = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  return Promise.resolve(h({ query: {}, body: {}, params: {}, headers: {}, ...r }, res)).then(() => res);
}
const okJson = (body: any) => ({ ok: true, json: async () => body });
const origFetch = global.fetch;
const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, FRONTEND_URL: 'https://app.example', SERVER_BASE_URL: 'https://api.example',
    FACEBOOK_APP_ID: 'fb-app', FACEBOOK_APP_SECRET: 'fb-secret', META_APP_ID: 'fb-app', META_APP_SECRET: 'fb-secret' };
  execRaw.mockResolvedValue(1);
  queryRaw.mockResolvedValue([]);
  (prisma.socialAccount.findFirst as jest.Mock).mockResolvedValue(null);
  global.fetch = jest.fn() as any;
});
afterAll(() => { process.env = OLD_ENV; global.fetch = origFetch; });

describe('M7: initiate binds the state to the signed-in user', () => {
  const initiate = handler(oauthRouter, 'get', '/initiate/:platform');

  test('stores user_id + business with a 10-minute expiry', async () => {
    asUser('user_A');
    const res = await call(initiate, { params: { platform: 'google_business' }, query: { businessId: 'biz-1' } });
    const [sql, state, biz, platform, user, expiresAt] = execRaw.mock.calls[0];
    expect(sql).toContain('user_id');
    expect([biz, platform, user]).toEqual(['biz-1', 'google_business', 'user_A']);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(res.json.mock.calls[0][0].url).toContain(`state=${state}`);
  });

  test('refuses without a signed-in user (the admin key has no user to bind to)', async () => {
    asUser(null);
    const res = await call(initiate, { params: { platform: 'google_business' }, query: { businessId: 'biz-1' } });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(execRaw).not.toHaveBeenCalled();
  });
});

describe('M7 + L14: the callback exchanges nothing and renders nothing; it sends the popup to our app', () => {
  const callback = handler(oauthRouter, 'get', '/callback/:platform');

  test('redirects to the frontend /oauth/callback with code + state in the fragment', async () => {
    const res = await call(callback, {
      params: { platform: "x'</script><script>alert(1)//" },
      query: { code: '</script><img src=x onerror=alert(1)>', state: 'abc' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execRaw).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    const url = new URL(res.redirect.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://app.example/oauth/callback');
    expect(url.search).toBe('');
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      platform: "x'</script><script>alert(1)//", code: '</script><img src=x onerror=alert(1)>', state: 'abc',
    });
  });

  test('a provider error goes to the same page as an error', async () => {
    const res = await call(callback, { params: { platform: 'google_business' }, query: { error: 'access_denied', code: 'c', state: 's' } });
    expect(res.redirect).toHaveBeenCalledWith('https://app.example/oauth/callback#error=access_denied');
  });

  test('the first FRONTEND_URL origin is the target', async () => {
    process.env.FRONTEND_URL = 'https://d8b8gahipsuc6.cloudfront.net/, https://cortexi.ai';
    const res = await call(callback, { params: { platform: 'google_business' }, query: { code: 'c', state: 's' } });
    expect(res.redirect.mock.calls[0][0]).toMatch(/^https:\/\/d8b8gahipsuc6\.cloudfront\.net\/oauth\/callback#/);
  });
});

describe('M7: /complete accepts the state only from the user who started the flow', () => {
  const complete = handler(oauthRouter, 'post', '/complete');
  const body = { platform: 'meta_ads', code: 'the-code', state: 'st-1', businessId: 'biz-evil' };

  test('401 without a signed-in user', async () => {
    asUser(null);
    expect((await call(complete, { body })).status).toHaveBeenCalledWith(401);
  });

  test('consumes the state in one statement keyed on user + platform + expiry; another user gets invalid_state', async () => {
    asUser('user_B');
    queryRaw.mockResolvedValueOnce([]); // the row belongs to someone else, was used, or expired
    const res = await call(complete, { body });
    expect(queryRaw.mock.calls[0][0]).toMatch(/DELETE FROM oauth_state_store WHERE id=\$1 AND user_id=\$2 AND platform=\$3 AND expires_at > NOW\(\)/);
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(['st-1', 'user_B', 'meta_ads']);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_state' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refuses when the user lost access to the business mid-flow', async () => {
    asUser('user_A', []);
    queryRaw.mockResolvedValueOnce([{ business_id: 'biz-1' }]);
    const res = await call(complete, { body });
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_state' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the matching user finishes; tokens go to the state\'s business, not one from the body', async () => {
    asUser('user_A');
    queryRaw.mockResolvedValueOnce([{ business_id: 'biz-1' }]);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(okJson({ access_token: 'short' }))
      .mockResolvedValueOnce(okJson({ access_token: 'long' }))
      .mockResolvedValueOnce(okJson({ data: [{ id: 'act_1', name: 'Ads', account_status: 1, currency: 'ILS' }] }));
    const res = await call(complete, { body });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, platform: 'meta_ads' }));
    const insert = execRaw.mock.calls.find(c => String(c[0]).includes('INSERT INTO social_accounts'));
    expect(insert[1]).toBe('biz-1');
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('code=the-code');
  });
});

describe('M7 + L14: the page picker is JSON for the app, and only the same user may confirm', () => {
  test('Facebook with several pages → picker → confirm', async () => {
    asUser('user_A');
    queryRaw.mockResolvedValueOnce([{ business_id: 'biz-1' }]);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(okJson({ access_token: 'short' }))
      .mockResolvedValueOnce(okJson({ access_token: 'long' }))
      .mockResolvedValueOnce(okJson({ data: [
        { id: '1', name: '<b>Page</b></script>', access_token: 'pt1' },
        { id: '2', name: 'Other', access_token: 'pt2' },
      ] }));
    const done = await call(handler(oauthRouter, 'post', '/complete'), { body: { platform: 'facebook_page', code: 'c', state: 's' } });
    const picker = done.json.mock.calls[0][0];
    expect(picker).toEqual({
      needs_page_selection: true, platform: 'facebook_page', session: expect.stringMatching(/^[0-9a-f]{32}$/),
      pages: [{ name: '<b>Page</b></script>', detail: 'ID: 1' }, { name: 'Other', detail: 'ID: 2' }],
    });
    expect(JSON.stringify(picker)).not.toContain('pt1'); // no page tokens reach the browser

    const confirm = handler(oauthRouter, 'post', '/confirm-page');
    asUser('user_B');
    const other = await call(confirm, { body: { session: picker.session, idx: 0 } });
    expect(other.status).toHaveBeenCalledWith(400);
    expect(prisma.businessProfile.updateMany).not.toHaveBeenCalled();

    asUser('user_A');
    const saved = await call(confirm, { body: { session: picker.session, idx: 0 } });
    expect(saved.json).toHaveBeenCalledWith({ ok: true, platform: 'facebook_page', page_name: '<b>Page</b></script>' });
    expect(prisma.businessProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'biz-1' } }));

    const again = await call(confirm, { body: { session: picker.session, idx: 1 } }); // single use
    expect(again.status).toHaveBeenCalledWith(400);
  });
});

describe('L6: disconnect revokes and deletes through lib/revokeTokens', () => {
  test('POST /disconnect hands the business + platform over', async () => {
    const res = await call(handler(oauthRouter, 'post', '/disconnect'), { body: { businessId: 'biz-1', platform: 'facebook_page' } });
    expect(disconnectIntegrations).toHaveBeenCalledWith(['biz-1'], 'facebook_page');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('M7: Messenger (meta/auth.ts) uses the same bound state', () => {
  test('initiate binds the state to the user and the business', async () => {
    asUser('user_A');
    const res = await call(handler(metaAuthRouter, 'get', '/facebook/initiate'), { query: { businessProfileId: 'biz-1' } });
    expect(execRaw.mock.calls[0].slice(2, 5)).toEqual(['biz-1', 'messenger', 'user_A']);
    expect(res.json.mock.calls[0][0].url).toContain('state=');
  });

  test('the callback refuses a state minted for another user, before exchanging the code', async () => {
    asUser('user_B');
    queryRaw.mockResolvedValueOnce([]);
    const res = await call(handler(metaAuthRouter, 'get', '/facebook/callback'), { query: { code: 'c', state: 'other-users-state' } });
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(['other-users-state', 'user_B', 'messenger']);
    expect(res.redirect).toHaveBeenCalledWith('https://app.example/integrations?error=invalid_state');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.metaConnection.upsert).not.toHaveBeenCalled();
  });
});

describe('L5: WhatsApp phone_number_id must belong to a WABA the token can access', () => {
  const signup = handler(metaAuthRouter, 'post', '/whatsapp/embedded-signup');

  test('wabaHasPhoneNumber checks the WABA\'s numbers with that token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okJson({ data: [{ id: '111' }, { id: '222' }] }));
    await expect(wabaHasPhoneNumber('999', '222', 'tok')).resolves.toBe(true);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toMatch(/\/999\/phone_numbers\?.*access_token=tok/);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(wabaHasPhoneNumber('999', '222', 'tok')).resolves.toBe(false);
    await expect(wabaHasPhoneNumber('../me', '222', 'tok')).resolves.toBe(false);
    await expect(wabaHasPhoneNumber(undefined, '222', 'tok')).resolves.toBe(false);
  });

  test('a number outside the token\'s WABA is refused before anything is stored', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okJson({ data: [{ id: '111' }] }));
    const res = await call(signup, { body: { code: 'EAAtoken', waba_id: '999', phone_number_id: '555', businessProfileId: 'biz-1' } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.metaConnection.upsert).not.toHaveBeenCalled();
  });

  test('a phone_number_id without a waba_id is refused', async () => {
    const res = await call(signup, { body: { code: 'EAAtoken', phone_number_id: '555', businessProfileId: 'biz-1' } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.metaConnection.upsert).not.toHaveBeenCalled();
  });

  test('a number in the WABA connects', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okJson({ data: [{ id: '555' }] }));
    (prisma.metaConnection.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.metaConnection.upsert as jest.Mock).mockResolvedValue({ id: 'mc1' });
    (prisma.businessProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.aIAgentConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'cfg' });
    const res = await call(signup, { body: { code: 'EAAtoken', waba_id: '999', phone_number_id: '555', businessProfileId: 'biz-1' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, phone_number_id: '555' }));
  });
});
