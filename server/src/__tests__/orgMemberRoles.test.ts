/**
 * Org member roles (server/src/routes/organizations.ts): a role must be one the app knows, only an
 * owner may grant, change or revoke owner/admin (re-inviting through the ON CONFLICT upsert
 * included), and the org's last active owner can't be demoted or revoked.
 */
jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() },
}));
jest.mock('../middleware/auth', () => ({ getUserId: jest.fn(() => 'caller') }));
jest.mock('../lib/email', () => ({
  sendEmail: jest.fn(() => Promise.resolve(true)),
  buildInviteEmail: jest.fn(() => ''),
  FRONTEND_URL: 'https://app.test',
}));

import { Request, Response } from 'express';
import { prisma } from '../db';
import router from '../routes/organizations';

const queryRaw = prisma.$queryRawUnsafe as jest.Mock;
const executeRaw = prisma.$executeRawUnsafe as jest.Mock;

// organization_members rows of org-1, by user id. The caller is 'caller'.
let members: Record<string, { role: string; status: string }>;

beforeEach(() => {
  members = {};
  queryRaw.mockImplementation(async (sql: string, _orgId: string, userId: string) => {
    const m = members[userId];
    if (sql.includes('SELECT role, branch_ids')) return m?.status === 'active' ? [{ role: m.role, branch_ids: null }] : [];
    if (sql.includes('SELECT role, status')) return m ? [m] : [];
    return [];
  });
  executeRaw.mockResolvedValue(1);
});

async function call(method: 'post' | 'patch' | 'delete', path: string, params: object, body: object = {}) {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
  await layer.route.stack[0].handle({ params, body, headers: {} } as unknown as Request, res, jest.fn());
  return { status: (res.status as jest.Mock).mock.calls[0]?.[0] ?? 200, body: json.mock.calls[0]?.[0] };
}
const invite = (body: object) => call('post', '/:id/members', { id: 'org-1' }, body);
const update = (memberId: string, body: object) =>
  call('patch', '/:id/members/:memberId', { id: 'org-1', memberId }, body);
const revoke = (memberId: string) => call('delete', '/:id/members/:memberId', { id: 'org-1', memberId });
const active = (role: string) => ({ role, status: 'active' });

describe('POST /api/orgs/:id/members — invite', () => {
  it('rejects roles the app does not know', async () => {
    members.caller = active('owner');
    for (const role of ['superuser', 'Owner', '', 42]) {
      expect((await invite({ user_id: 'u2', role })).status).toBe(400);
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('lets only an owner invite an owner or admin', async () => {
    members.caller = active('admin');
    expect((await invite({ user_id: 'u2', role: 'owner' })).status).toBe(403);
    expect((await invite({ email: 'x@example.com', role: 'admin' })).status).toBe(403);
    expect(executeRaw).not.toHaveBeenCalled();

    members.caller = active('owner');
    expect((await invite({ user_id: 'u2', role: 'admin' })).status).toBe(200);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('stops an admin from overwriting the owner\'s row by re-inviting them (ON CONFLICT upsert)', async () => {
    members.caller = active('admin');
    members['owner-1'] = active('owner');
    expect((await invite({ user_id: 'owner-1', role: 'viewer' })).status).toBe(403);
    // A pending admin invite is an admin grant too.
    members['invite:pending@example.com'] = { role: 'admin', status: 'pending' };
    expect((await invite({ email: 'pending@example.com', role: 'viewer' })).status).toBe(403);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('lets an admin invite editors and viewers', async () => {
    members.caller = active('admin');
    const r = await invite({ email: 'new@example.com', role: 'viewer' });
    expect(r.status).toBe(200);
    expect(executeRaw.mock.calls[0][4]).toBe('viewer');
  });

  it('refuses a re-invite that would leave the org without an active owner', async () => {
    members.caller = active('owner');
    executeRaw.mockResolvedValue(0); // the upsert's guard matched no row
    const r = await invite({ user_id: 'caller', role: 'viewer' });
    expect(r.status).toBe(409);
    expect(executeRaw.mock.calls[0][0]).toMatch(/ON CONFLICT[\s\S]*WHERE[\s\S]*o\.role = 'owner'[\s\S]*FOR UPDATE/);
  });

  it('refuses members who are not owner or admin', async () => {
    for (const role of ['content_editor', 'viewer', 'manager']) {
      members.caller = active(role);
      expect((await invite({ user_id: 'u2', role: 'viewer' })).status).toBe(403);
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/orgs/:id/members/:memberId — role change', () => {
  it('rejects roles the app does not know', async () => {
    members.caller = active('owner');
    members.u2 = active('viewer');
    expect((await update('u2', { role: 'superuser' })).status).toBe(400);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('stops an admin from promoting anyone to owner or admin', async () => {
    members.caller = active('admin');
    members.u2 = active('viewer');
    expect((await update('u2', { role: 'owner' })).status).toBe(403);
    expect((await update('u2', { role: 'admin' })).status).toBe(403);
    expect((await update('caller', { role: 'owner' })).status).toBe(403); // not even themselves
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('stops an admin from changing an owner or another admin, branches included', async () => {
    members.caller = active('admin');
    members['owner-1'] = active('owner');
    members['admin-2'] = active('admin');
    expect((await update('owner-1', { role: 'viewer' })).status).toBe(403);
    expect((await update('owner-1', { branch_ids: ['b1'] })).status).toBe(403);
    expect((await update('admin-2', { role: 'viewer' })).status).toBe(403);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('lets an admin move members between the other roles', async () => {
    members.caller = active('admin');
    members.u2 = active('viewer');
    expect((await update('u2', { role: 'content_editor' })).status).toBe(200);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('never demotes the last active owner', async () => {
    members.caller = active('owner');
    executeRaw.mockResolvedValue(0);
    const r = await update('caller', { role: 'admin' });
    expect(r.status).toBe(409);
    expect(executeRaw.mock.calls[0][0]).toMatch(/o\.user_id <> \$4 AND o\.role = 'owner' AND o\.status = 'active'/);
  });

  it('lets an owner demote another owner while one remains', async () => {
    members.caller = active('owner');
    members['owner-2'] = active('owner');
    expect((await update('owner-2', { role: 'admin' })).status).toBe(200);
  });

  it('404s a member that does not exist', async () => {
    members.caller = active('owner');
    expect((await update('ghost', { role: 'viewer' })).status).toBe(404);
  });
});

describe('DELETE /api/orgs/:id/members/:memberId — revoke', () => {
  it('stops an admin from revoking an owner or admin', async () => {
    members.caller = active('admin');
    members['owner-1'] = active('owner');
    members['admin-2'] = active('admin');
    expect((await revoke('owner-1')).status).toBe(403);
    expect((await revoke('admin-2')).status).toBe(403);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('lets an admin revoke editors and viewers', async () => {
    members.caller = active('admin');
    members.u2 = active('content_editor');
    expect((await revoke('u2')).status).toBe(200);
  });

  it('never revokes the last active owner', async () => {
    members.caller = active('owner');
    executeRaw.mockResolvedValue(0);
    expect((await revoke('caller')).status).toBe(409);
    expect(executeRaw.mock.calls[0][0]).toMatch(/SET status = 'revoked'[\s\S]*o\.role = 'owner'[\s\S]*FOR UPDATE/);
  });

  it('404s a member that does not exist', async () => {
    members.caller = active('owner');
    expect((await revoke('ghost')).status).toBe(404);
  });
});
