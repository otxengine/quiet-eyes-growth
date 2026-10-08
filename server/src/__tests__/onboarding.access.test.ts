import router from '../routes/onboarding';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { getUserBusinessIds } from '../lib/ownership';

jest.mock('../db', () => ({ prisma: { businessProfile: { findUnique: jest.fn(), update: jest.fn() } } }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(), isAdminKeyRequest: jest.fn(() => false) }));
jest.mock('../lib/ownership', () => ({ getUserBusinessIds: jest.fn(), getUserEmail: jest.fn() }));
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

function post(url: string, body: Record<string, any>): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = { method: 'POST', url, originalUrl: url, params: {}, headers: {}, body };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    router(req, res, (err?: any) => err ? reject(err) : resolve({ statusCode: 404, body: null }));
  });
}

beforeEach(() => jest.clearAllMocks());

describe('onboarding routes require an owner of businessProfileId', () => {
  it('401 without a signed-in user — the handler never runs', async () => {
    (getUserId as jest.Mock).mockReturnValue(null);
    const { statusCode } = await post('/approve-about', { businessProfileId: 'bp1', draft: {} });
    expect(statusCode).toBe(401);
    expect(prisma.businessProfile.findUnique).not.toHaveBeenCalled();
  });

  it("403 for another user's business", async () => {
    (getUserId as jest.Mock).mockReturnValue('u1');
    (getUserBusinessIds as jest.Mock).mockResolvedValue(['mine']);
    for (const path of ['/generate-about', '/approve-about', '/reject-about']) {
      expect((await post(path, { businessProfileId: 'not-mine' })).statusCode).toBe(403);
    }
    expect(prisma.businessProfile.update).not.toHaveBeenCalled();
  });
});
