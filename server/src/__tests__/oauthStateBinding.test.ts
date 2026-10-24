/**
 * OAuth state is bound to the signed-in user + business, single use, short-lived (M7); popup pages
 * escape what they print and post only to our own frontend origins (L14); WhatsApp's
 * phone_number_id must be in a WABA the token can read (L5).
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
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(), isAdminKeyRequest: jest.fn(() => false) }));
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

describe('M7 + L14: the callback page exchanges nothing and posts only to our origins', () => {
  const callback = handler(oauthRouter, 'get', '/callback/:platform');

  test('hands code + state to the opener at the frontend origin, escaped, never to "*"', async () => {
    const res = await call(callback, {
      params: { platform: "x'</script><script>alert(1)//" },
      query: { code: '</script><img src=x onerror=alert(1)>', state: 'abc' },
    });
    const html: string = res.send.mock.calls[0][0];
    expect(global.fetch).not.toHaveBeenCalled();
    expect(execRaw).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(html).not.toContain("'*'");
    expect(html).toContain('["https://app.example"].forEach');
    expect(html).not.toMatch(/<\/script><(script|img)/);
    expect(html).toContain('"type":"oauth_code"');
    expect(html).toContain('\\u003c/script>\\u003cimg src=x onerror=alert(1)>');
  });

  test('a provider error renders an oauth_error page, escaped', async () => {
    const res = await call(callback, { params: { platform: 'google_business' }, query: { error: '"><svg onload=alert(1)>' } });
    const html: string = res.send.mock.calls[0][0];
    expect(html).toContain('"type":"oauth_error"');
    expect(html).not.toContain('<svg');
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

describe('L14: picker and confirm pages escape third-party names and post only to our origins', () => {
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
    const { needs_page_selection, session } = done.json.mock.calls[0][0];
    expect(needs_page_selection).toBe(true);

    const confirm = handler(oauthRouter, 'get', '/confirm-page');
    const picker: string = (await call(confirm, { query: { session } })).send.mock.calls[0][0];
    expect(picker).toContain('&lt;b&gt;Page&lt;/b&gt;&lt;/script&gt;');
    expect(picker).not.toContain('<b>Page');

    const saved: string = (await call(confirm, { query: { session, idx: '0' } })).send.mock.calls[0][0];
    expect(saved).toContain('"type":"oauth_success"');
    expect(saved).toContain('["https://app.example"].forEach');
    expect(saved).not.toContain("'*'");
    expect(saved.match(/<\/script>/g)).toHaveLength(1); // only the page's own closing tag
    expect(saved).not.toContain('<b>');
    expect(prisma.businessProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'biz-1' } }));
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
