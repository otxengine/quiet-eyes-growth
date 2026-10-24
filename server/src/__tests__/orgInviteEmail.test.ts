/**
 * L8: an org invite link can be claimed only by the invited address, once Clerk has verified it
 * as the accepting user's primary email (lib/ownership.ts getUserEmail).
 */
jest.mock('../db', () => ({ prisma: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() } }));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => 'user_B') }));
jest.mock('../lib/ownership', () => ({ getUserEmail: jest.fn() }));
jest.mock('../lib/email', () => ({ sendEmail: jest.fn(), buildInviteEmail: jest.fn(), FRONTEND_URL: 'https://app.example' }));
jest.mock('../lib/orgHelpers', () => ({ getOrCreateOrgForProfile: jest.fn() }));
jest.mock('../routes/billing', () => ({ syncPaddleQuantity: jest.fn() }));

import { prisma } from '../db';
import { getUserEmail } from '../lib/ownership';
import router from '../routes/organizations';

const queryRaw = prisma.$queryRawUnsafe as jest.Mock;
const execRaw  = prisma.$executeRawUnsafe as jest.Mock;
const layer: any = (router as any).stack.find((l: any) => l.route?.path === '/join/:token' && l.route.methods.post);
const join = layer.route.stack[0].handle;

async function claim(verifiedEmail: string | null, inviteEmail: string | null = 'Invited@Example.com') {
  (getUserEmail as jest.Mock).mockResolvedValue(verifiedEmail);
  queryRaw.mockResolvedValueOnce([{ id: 'm1', org_id: 'org1', role: 'content_editor', email: inviteEmail }]);
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  await join({ params: { token: 't0k' }, headers: {}, query: {}, body: {} }, res);
  return res;
}
const claimed = () => execRaw.mock.calls.some(c => String(c[0]).includes("status = 'active'"));

beforeEach(() => { execRaw.mockResolvedValue(1); });

test('the invited address, verified (any case), claims the invite', async () => {
  const res = await claim('invited@example.com');
  expect(getUserEmail).toHaveBeenCalledWith('user_B');
  expect(claimed()).toBe(true);
  expect(res.json).toHaveBeenCalledWith({ ok: true, orgId: 'org1', role: 'content_editor' });
});

test('another user holding the link is refused, and the invite stays pending', async () => {
  const res = await claim('someone-else@example.com');
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: 'invite_email_mismatch' });
  expect(claimed()).toBe(false);
});

test('an unverified primary email (getUserEmail → null) is refused', async () => {
  const res = await claim(null);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(claimed()).toBe(false);
});

test('an invite row with no email is refused', async () => {
  const res = await claim('invited@example.com', null);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(claimed()).toBe(false);
});
