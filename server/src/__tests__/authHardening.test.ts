/**
 * middleware/auth.ts: real Clerk keys only and no dev-user fallback in production (L1),
 * constant-time secret compares with the cron secret taken from a header (L2), and Clerk's
 * authorizedParties (L12).
 */
const mockClerk = jest.fn((_req: any, _res: any, next: any) => next());
const mockClerkMiddleware = jest.fn((_opts: any) => mockClerk);
jest.mock('@clerk/express', () => ({ clerkMiddleware: mockClerkMiddleware, getAuth: jest.fn(() => ({ userId: 'user_1' })) }));

export {}; // a module, so names don't clash with other test files

type AuthModule = typeof import('../middleware/auth');
const OLD_ENV = process.env;
// A publishable key's body is base64 of "<frontend api host>$"
const REAL_KEYS = {
  CLERK_SECRET_KEY: 'sk_test_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3',
  CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64'),
};

function loadAuth(env: Record<string, string | undefined>): AuthModule {
  process.env = { ...OLD_ENV, CLERK_SECRET_KEY: '', CLERK_PUBLISHABLE_KEY: '', ...env };
  let mod: AuthModule | undefined;
  jest.isolateModules(() => { mod = require('../middleware/auth'); });
  return mod!;
}
const req = (headers: Record<string, string> = {}, query: Record<string, string> = {}) => ({ headers, query }) as any;
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }) as any;

afterAll(() => { process.env = OLD_ENV; });

describe('L1: Clerk keys and the dev-user fallback', () => {
  test.each([
    ['empty', '', ''],
    ['your_key_here', 'your_key_here', 'your_key_here'],
    ['.env.example style sk_test_...', 'sk_test_...', REAL_KEYS.CLERK_PUBLISHABLE_KEY],
    ['short sk_test_your_key_here', 'sk_test_your_key_here', REAL_KEYS.CLERK_PUBLISHABLE_KEY],
    ['publishable key that is not Clerk-encoded', REAL_KEYS.CLERK_SECRET_KEY, 'pk_test_your_key_here'],
  ])('placeholder keys (%s) leave Clerk off', (_name, sk, pk) => {
    expect(loadAuth({ CLERK_SECRET_KEY: sk, CLERK_PUBLISHABLE_KEY: pk }).CLERK_ENABLED).toBe(false);
  });

  test('real-looking keys turn Clerk on', () => {
    expect(loadAuth(REAL_KEYS).CLERK_ENABLED).toBe(true);
  });

  test('production without Clerk fails closed: no dev-user, x-dev-user ignored, requireAuth 401s', () => {
    const auth = loadAuth({ NODE_ENV: 'production', CLERK_SECRET_KEY: 'your_key_here', CLERK_PUBLISHABLE_KEY: 'your_key_here' });
    expect(auth.getUserId(req())).toBeNull();
    expect(auth.getUserId(req({ 'x-dev-user': 'dev-user-2' }))).toBeNull();
    const r = res(); const next = jest.fn();
    auth.requireAuth(req(), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });

  test('local dev without Clerk still runs as a dev user', () => {
    const auth = loadAuth({ NODE_ENV: 'development' });
    expect(auth.getUserId(req())).toBe('dev-user');
    expect(auth.getUserId(req({ 'x-dev-user': 'dev-user-2' }))).toBe('dev-user-2');
  });
});

describe('L2: secret compares', () => {
  test('safeEqual matches only the exact secret, and never an empty one', () => {
    const { safeEqual } = loadAuth({});
    expect(safeEqual('s3cret', 's3cret')).toBe(true);
    expect(safeEqual('s3cre', 's3cret')).toBe(false);
    expect(safeEqual('s3cret-and-more', 's3cret')).toBe(false);
    expect(safeEqual(['s3cret'], 's3cret')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(undefined, '')).toBe(false);
  });

  test('admin key: exact header match, off when ADMIN_SECRET is unset', () => {
    expect(loadAuth({ ADMIN_SECRET: 'adm' }).isAdminKeyRequest(req({ 'x-admin-key': 'adm' }))).toBe(true);
    expect(loadAuth({ ADMIN_SECRET: 'adm' }).isAdminKeyRequest(req({ 'x-admin-key': 'adx' }))).toBe(false);
    expect(loadAuth({ ADMIN_SECRET: '' }).isAdminKeyRequest(req({ 'x-admin-key': '' }))).toBe(false);
  });

  test('cron secret comes from the x-cron-secret header; the query string no longer works', () => {
    const { isCronRequest } = loadAuth({ CRON_SECRET: 'cron-s3cret' });
    expect(isCronRequest(req({ 'x-cron-secret': 'cron-s3cret' }))).toBe(true);
    expect(isCronRequest(req({}, { secret: 'cron-s3cret' }))).toBe(false);
    expect(isCronRequest(req({ 'x-cron-secret': 'wrong' }))).toBe(false);
    process.env.CRON_SECRET = '';
    expect(isCronRequest(req({ 'x-cron-secret': '' }))).toBe(false);
  });

  test('migration secret header is compared with safeEqual', async () => {
    jest.resetModules();
    process.env = { ...OLD_ENV, MIGRATION_SECRET: 'mig', ADMIN_SECRET: '' };
    jest.doMock('../db', () => ({ prisma: { $executeRawUnsafe: jest.fn().mockResolvedValue(0) } }));
    const router = require('../routes/migrate').default;
    const handler = router.stack.find((l: any) => l.route?.path === '/').route.stack[0].handle;
    const r = res();
    await handler(req({ 'x-migration-secret': 'nope' }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    jest.dontMock('../db');
  });

  // The DataForSEO postback keeps its ?secret= (a postback_url can't carry headers): dataforseoWebhook.test.ts
});

describe('L12: Clerk authorizedParties', () => {
  test('clerkAuth passes the allowed origins as authorizedParties and skips admin-key requests', () => {
    const { clerkAuth } = loadAuth(REAL_KEYS);
    const origins = ['https://cortexi.ai', 'https://quiet-eyes-growth.onrender.com'];
    const mw = clerkAuth(origins);
    expect(mockClerkMiddleware).toHaveBeenCalledWith(expect.objectContaining({
      authorizedParties: origins, publishableKey: REAL_KEYS.CLERK_PUBLISHABLE_KEY,
    }));

    const next = jest.fn();
    mw(req({ authorization: 'Bearer t' }), res(), next);
    expect(mockClerk).toHaveBeenCalledTimes(1);
    mw(req({ 'x-admin-key': 'adm' }), res(), next);
    expect(mockClerk).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
