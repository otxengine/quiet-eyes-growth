/**
 * Generic entities API:
 *  - AutoAction is read-only here, so a client can't rewrite an action and skip approval.
 *  - BusinessProfile / SocialAccount credentials never go out (has_<field> flags instead)
 *    and can't be written through this API.
 *  - A 500 carries no Prisma code or message.
 */
jest.mock('../db', () => ({
  prisma: {
    autoAction:      { create: jest.fn(), update: jest.fn(), delete: jest.fn(), findFirst: jest.fn() },
    businessProfile: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    socialAccount:   { findMany: jest.fn() },
  },
}));
jest.mock('../middleware/auth', () => ({
  getUserId: jest.fn().mockReturnValue('user_1'),
  isAdminKeyRequest: jest.fn().mockReturnValue(false),
}));
jest.mock('../lib/ownership', () => ({
  getUserBusinessIds: jest.fn().mockResolvedValue(['biz_1']),
  getUserWritableBusinessIds: jest.fn().mockResolvedValue(['biz_1']),
  getUserEmail: jest.fn(),
}));
jest.mock('../lib/competitorRadiusCleanup', () => ({ cleanupCompetitorsByRadius: jest.fn() }));

import router from '../routes/entities';
import { prisma } from '../db';

const db = prisma as any;

function handler(path: string, method: string) {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[0].handle;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const req = (params: any, extra: any = {}) => ({ params, query: {}, body: {}, headers: {}, ...extra }) as any;

describe('AutoAction is read-only through the entities API', () => {
  test.each([
    ['post', '/:entity', { entity: 'AutoAction' }],
    ['patch', '/:entity/:id', { entity: 'AutoAction', id: 'a1' }],
    ['delete', '/:entity/:id', { entity: 'AutoAction', id: 'a1' }],
  ])('%s is refused before touching the DB', async (method, path, params) => {
    const res = makeRes();
    await handler(path, method)(req(params, {
      body: { action_type: 'email_send', payload: '{"to":"x@example.com"}', auto_execute_at: '2000-01-01T00:00:00Z' },
    }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(db.autoAction.create).not.toHaveBeenCalled();
    expect(db.autoAction.update).not.toHaveBeenCalled();
    expect(db.autoAction.delete).not.toHaveBeenCalled();
  });
});

describe('credentials stay on the server', () => {
  beforeEach(() => jest.clearAllMocks());

  test('BusinessProfile reads drop token fields and say whether each is set', async () => {
    db.businessProfile.findMany.mockResolvedValue([{
      id: 'biz_1', name: 'Shop', google_access_token: 'enc-g', whatsapp_access_token: null,
      instagram_access_token: 'enc-i', facebook_page_token: 'enc-f', channels_webhook_secret: 's',
    }]);
    const res = makeRes();
    await handler('/:entity', 'get')(req({ entity: 'BusinessProfile' }), res);

    const [row] = res.json.mock.calls[0][0];
    expect(row).toEqual({
      id: 'biz_1', name: 'Shop',
      has_google_access_token: true, has_whatsapp_access_token: false,
      has_instagram_access_token: true, has_facebook_page_token: true, has_channels_webhook_secret: true,
    });
  });

  test('SocialAccount reads drop access and refresh tokens', async () => {
    db.socialAccount.findMany.mockResolvedValue([{ id: 's1', platform: 'facebook_page', access_token: 'enc-a', refresh_token: null }]);
    const res = makeRes();
    await handler('/:entity', 'get')(req({ entity: 'SocialAccount' }, { query: { filter: '{"linked_business":"biz_1"}' } }), res);

    expect(res.json.mock.calls[0][0]).toEqual([{ id: 's1', platform: 'facebook_page', has_access_token: true, has_refresh_token: false }]);
  });

  test('a PATCH can neither set a token nor read one back', async () => {
    db.businessProfile.findFirst.mockResolvedValue({ id: 'biz_1', created_by: 'user_1' });
    db.businessProfile.update.mockResolvedValue({ id: 'biz_1', name: 'New', google_access_token: 'enc-g' });
    const res = makeRes();
    await handler('/:entity/:id', 'patch')(req({ entity: 'BusinessProfile', id: 'biz_1' }, {
      body: { name: 'New', whatsapp_access_token: 'plain', has_google_access_token: true },
    }), res);

    expect(db.businessProfile.update).toHaveBeenCalledWith({ where: { id: 'biz_1' }, data: { name: 'New' } });
    expect(res.json).toHaveBeenCalledWith({ id: 'biz_1', name: 'New', has_google_access_token: true });
  });

  test('a failed read returns a generic 500 with no Prisma code or message', async () => {
    db.businessProfile.findMany.mockRejectedValue(Object.assign(new Error('Invalid `prisma.businessProfile.findMany()` column x'), { code: 'P2022' }));
    const res = makeRes();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await handler('/:entity', 'get')(req({ entity: 'BusinessProfile' }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });
});
