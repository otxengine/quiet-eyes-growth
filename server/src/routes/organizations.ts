/**
 * organizations.ts — Multi-branch / multi-user organization management.
 *
 * Routes:
 *   GET  /api/orgs/my            → list all orgs + branches for current user
 *   POST /api/orgs               → create organization
 *   GET  /api/orgs/:id           → get org details
 *   PATCH /api/orgs/:id          → update org name / is_agency
 *   POST /api/orgs/:id/members   → invite / add member
 *   PATCH /api/orgs/:id/members/:userId → update member role / branch access
 *   DELETE /api/orgs/:id/members/:userId → remove member
 *   GET  /api/orgs/:id/branches  → list branches (BusinessProfiles in this org)
 *   POST /api/orgs/:id/branches  → create new branch (new BusinessProfile)
 *   DELETE /api/orgs/:id/branches/:branchId → deactivate branch
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { syncPaddleQuantity } from './billing';
import { sendEmail, buildInviteEmail, FRONTEND_URL } from '../lib/email';
import { getOrCreateOrgForProfile } from '../lib/orgHelpers';
import { ORG_ROLES, ORG_ADMIN_ROLES } from '../lib/ownership';
import crypto from 'crypto';

type Params = Record<string, string>;

const router = Router();

// ── Helper: verify user has access to org ────────────────────────────────────

async function getOrgMembership(
  orgId: string,
  userId: string,
): Promise<{ role: string; branch_ids: string | null } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT role, branch_ids FROM organization_members
       WHERE org_id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      orgId, userId,
    );
    return rows?.[0] || null;
  } catch { return null; }
}

async function isOrgOwnerOrAdmin(orgId: string, userId: string): Promise<boolean> {
  const m = await getOrgMembership(orgId, userId);
  return m?.role === 'owner' || m?.role === 'admin';
}

/** A member row in any status (pending invites included), for checks on the member being changed. */
async function getMemberRow(orgId: string, userId: string): Promise<{ role: string; status: string } | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT role, status FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    orgId, userId,
  );
  return rows?.[0] || null;
}

/** Only an owner may grant, change or revoke owner or admin: `roles` are the member's current and new roles. */
function mayAssign(callerRole: string, ...roles: (string | null | undefined)[]): boolean {
  return callerRole === 'owner' || !roles.some(r => r && ORG_ADMIN_ROLES.has(r));
}

const ADMIN_ROLE_ONLY_OWNER = 'Only an owner can grant, change or revoke the owner or admin role';
const LAST_OWNER = 'An organization must keep at least one active owner';

// WHERE condition for changing the member row (org, user): it holds unless that row is the org's
// last active owner. FOR UPDATE locks the other owners' rows, so two owners demoting each other at
// the same moment can't both get through.
const notLastOwner = (org: string, user: string) =>
  `(organization_members.role <> 'owner' OR organization_members.status <> 'active'
    OR EXISTS (SELECT 1 FROM organization_members o
               WHERE o.org_id = ${org} AND o.user_id <> ${user} AND o.role = 'owner' AND o.status = 'active'
               FOR UPDATE))`;

// ── GET /api/orgs/my ──────────────────────────────────────────────────────────
// Returns all orgs the user belongs to + their branches.
// Also auto-creates an org for legacy users (BusinessProfile without org).

router.get('/my', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // 1. Find all orgs where user is a member
    const memberRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT o.*, om.role, om.branch_ids
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'
       ORDER BY o.created_at ASC`,
      userId,
    );

    // 2. For legacy users: find BusinessProfiles with created_by = userId but no org.
    //    In production, created_by stores the Clerk userId directly.
    const orphanProfiles = await prisma.businessProfile.findMany({
      where: { created_by: userId },
    }).catch(() => []);

    // Auto-create org for orphan profiles — seed with the profile's real plan
    // instead of a hardcoded default, so legacy accounts aren't mislabeled.
    for (const profile of orphanProfiles) {
      const linked = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM business_profiles WHERE id = $1 AND organization_id IS NOT NULL LIMIT 1`,
        profile.id,
      ).catch(() => []);
      if (linked?.length > 0) continue;

      const planId = (profile as any).subscription_plan || (profile as any).plan_id || 'free_trial';
      const orgId = await getOrCreateOrgForProfile(profile, userId, planId);

      if (!memberRows.some((o) => o.id === orgId)) {
        const orgRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM organizations WHERE id = $1 LIMIT 1`, orgId,
        ).catch(() => []);
        if (orgRows?.[0]) memberRows.push({ ...orgRows[0], role: 'owner', branch_ids: null });
      }
    }

    // 3. Fetch branches for each org
    const orgsWithBranches = await Promise.all(
      memberRows.map(async (org) => {
        let branchQuery = `SELECT id, name, city, category, onboarding_completed,
                              organization_id, branch_display_name, branch_role, branch_sort_order
                           FROM business_profiles
                           WHERE organization_id = $1 AND (is_active IS NULL OR is_active = true)
                           ORDER BY COALESCE(branch_sort_order, 0) ASC`;

        // Managers with limited branch access
        if (org.role === 'manager' && org.branch_ids) {
          try {
            const ids: string[] = JSON.parse(org.branch_ids);
            if (ids.length > 0) {
              branchQuery = `SELECT id, name, city, category, onboarding_completed,
                                organization_id, branch_display_name, branch_role, branch_sort_order
                             FROM business_profiles
                             WHERE organization_id = $1 AND id = ANY($2::text[])
                               AND (is_active IS NULL OR is_active = true)
                             ORDER BY COALESCE(branch_sort_order, 0) ASC`;
              const branches = await prisma.$queryRawUnsafe<any[]>(branchQuery, org.id, ids);
              return { ...org, branches };
            }
          } catch {}
        }

        const branches = await prisma.$queryRawUnsafe<any[]>(branchQuery, org.id);
        return { ...org, branches };
      }),
    );

    // 4. For agency accounts, also fetch managed clients
    const agencyClients: any[] = [];
    for (const org of orgsWithBranches) {
      if (!org.is_agency) continue;
      const clients = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ac.*, o.name as client_name, o.id as client_org_id
         FROM agency_clients ac
         JOIN organizations o ON o.id = ac.client_org_id
         WHERE ac.agency_org_id = $1 AND ac.status = 'active'`,
        org.id,
      );
      agencyClients.push(...clients);
    }

    return res.json({ orgs: orgsWithBranches, agencyClients });
  } catch (err: any) {
    console.error('[orgs/my]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/orgs — create organization ─────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, is_agency = false } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const org = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO organizations (id, name, owner_user_id, is_agency, plan_id, branch_count, subscription_status, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'starter', 0, 'active', NOW())
       RETURNING *`,
      name, userId, is_agency,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO organization_members (id, org_id, user_id, role, status, invited_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'owner', 'active', NOW())`,
      org[0].id, userId,
    );
    return res.json(org[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/orgs/:id ─────────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  const membership = await getOrgMembership(id, userId);
  if (!membership) return res.status(403).json({ error: 'No access' });

  const orgs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM organizations WHERE id = $1`, id,
  );
  if (!orgs?.length) return res.status(404).json({ error: 'Not found' });

  const members = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM organization_members WHERE org_id = $1 AND status = 'active'`, id,
  );

  return res.json({ ...orgs[0], members, myRole: membership.role });
});

// ── PATCH /api/orgs/:id ───────────────────────────────────────────────────────

router.patch('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  const { name, is_agency } = req.body;
  const updates: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (name   !== undefined) { updates.push(`name = $${i++}`);      vals.push(name); }
  if (is_agency !== undefined) { updates.push(`is_agency = $${i++}`); vals.push(is_agency); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(id);
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${i}`, ...vals,
  );
  return res.json({ ok: true });
});

// ── POST /api/orgs/:id/members ────────────────────────────────────────────────

router.post('/:id/members', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  const caller = await getOrgMembership(id, userId);
  if (!caller || !ORG_ADMIN_ROLES.has(caller.role)) return res.status(403).json({ error: 'Insufficient role' });

  const { user_id, email, role = 'content_editor', branch_ids, inviter_name } = req.body;
  if (!user_id && !email) return res.status(400).json({ error: 'user_id or email required' });
  if (!ORG_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' });

  // For email-only invites generate a unique token (7-day expiry)
  const isEmailInvite = !user_id && !!email;
  const inviteToken   = isEmailInvite ? crypto.randomBytes(32).toString('hex') : null;
  const tokenExpiry   = isEmailInvite ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;

  const targetUserId = user_id || `invite:${email}`;
  try {
    // Re-inviting an existing member overwrites their row (ON CONFLICT below), so it is a role change too.
    const existing = await getMemberRow(id, targetUserId);
    if (!mayAssign(caller.role, role, existing?.role)) return res.status(403).json({ error: ADMIN_ROLE_ONLY_OWNER });

    const written = await prisma.$executeRawUnsafe(
      `INSERT INTO organization_members
         (id, org_id, user_id, email, role, branch_ids, invited_by, invited_at, status, invite_token, token_expires_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW(), 'pending', $7, $8)
       ON CONFLICT (org_id, user_id) DO UPDATE
         SET role = $4, branch_ids = $5, status = 'pending',
             invite_token = $7, token_expires_at = $8
         WHERE ${notLastOwner('$1', '$2')}`,
      id, targetUserId, email || null, role,
      branch_ids ? JSON.stringify(branch_ids) : null,
      userId, inviteToken, tokenExpiry,
    );
    if (!written) return res.status(409).json({ error: LAST_OWNER });

    // Fetch org name for the invite email
    let orgName = 'הארגון';
    let emailSent = false;
    try {
      const orgRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT name FROM organizations WHERE id = $1`, id,
      );
      orgName = orgRows?.[0]?.name || orgName;
    } catch {}

    if (isEmailInvite && inviteToken) {
      emailSent = await sendEmail({
        to:      email!,
        subject: `הוזמנת להצטרף ל-${orgName} ב-OTX`,
        html:    buildInviteEmail({
          inviterName: inviter_name || 'מנהל הארגון',
          orgName,
          role,
          inviteToken,
        }),
      });
    }

    const inviteLink = inviteToken ? `${FRONTEND_URL}/join?token=${inviteToken}` : null;
    return res.json({ ok: true, emailSent, inviteLink });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/orgs/:id/members/:memberId ────────────────────────────────────

router.patch('/:id/members/:memberId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, memberId } = req.params as Params;

  const caller = await getOrgMembership(id, userId);
  if (!caller || !ORG_ADMIN_ROLES.has(caller.role)) return res.status(403).json({ error: 'Insufficient role' });

  const { role, branch_ids } = req.body;
  if (role && !ORG_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' });

  const target = await getMemberRow(id, memberId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (!mayAssign(caller.role, target.role, role)) return res.status(403).json({ error: ADMIN_ROLE_ONLY_OWNER });

  // Any other role demotes the member if they are an owner; the guard keeps one active owner.
  const demotesOwner = !!role && role !== 'owner';
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE organization_members SET role = COALESCE($1, role), branch_ids = COALESCE($2, branch_ids)
     WHERE org_id = $3 AND user_id = $4${demotesOwner ? ` AND ${notLastOwner('$3', '$4')}` : ''}`,
    role || null, branch_ids ? JSON.stringify(branch_ids) : null, id, memberId,
  );
  if (!updated) return res.status(409).json({ error: LAST_OWNER });
  return res.json({ ok: true });
});

// ── DELETE /api/orgs/:id/members/:memberId ───────────────────────────────────

router.delete('/:id/members/:memberId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, memberId } = req.params as Params;

  const caller = await getOrgMembership(id, userId);
  if (!caller || !ORG_ADMIN_ROLES.has(caller.role)) return res.status(403).json({ error: 'Insufficient role' });

  const target = await getMemberRow(id, memberId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (!mayAssign(caller.role, target.role)) return res.status(403).json({ error: ADMIN_ROLE_ONLY_OWNER });

  const revoked = await prisma.$executeRawUnsafe(
    `UPDATE organization_members SET status = 'revoked'
     WHERE org_id = $1 AND user_id = $2 AND ${notLastOwner('$1', '$2')}`,
    id, memberId,
  );
  if (!revoked) return res.status(409).json({ error: LAST_OWNER });
  return res.json({ ok: true });
});

// ── GET /api/orgs/:id/branches ────────────────────────────────────────────────

router.get('/:id/branches', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  const membership = await getOrgMembership(id, userId);
  if (!membership) return res.status(403).json({ error: 'No access' });

  const branches = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, city, category, onboarding_completed,
            branch_display_name, branch_role, branch_sort_order
     FROM business_profiles
     WHERE organization_id = $1 AND (is_active IS NULL OR is_active = true)
     ORDER BY COALESCE(branch_sort_order, 0) ASC`,
    id,
  );
  return res.json(branches);
});

// ── POST /api/orgs/join/:token ────────────────────────────────────────────────
// Called when an invited user clicks their invite link after signing in.

router.post('/join/:token', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { token } = req.params as Params;

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM organization_members
       WHERE invite_token = $1 AND status = 'pending'
         AND (token_expires_at IS NULL OR token_expires_at > NOW())
       LIMIT 1`,
      token,
    );
    if (!rows?.length) return res.status(404).json({ error: 'invite_not_found' });

    const invite = rows[0];
    // Claim the invite — replace the placeholder user_id with the real one
    await prisma.$executeRawUnsafe(
      `UPDATE organization_members
       SET user_id = $1, status = 'active', invite_token = NULL, token_expires_at = NULL
       WHERE id = $2`,
      userId, invite.id,
    );
    return res.json({ ok: true, orgId: invite.org_id, role: invite.role });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/orgs/:id/branches ───────────────────────────────────────────────
// Creates a new BusinessProfile linked to this org (new branch).

router.post('/:id/branches', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  const {
    name, city, category, branch_display_name,
    full_address, phone, website_url, description, google_place_id,
  } = req.body;
  if (!name || !city || !category) return res.status(400).json({ error: 'name, city, category required' });

  // Get the org's main profile for defaults
  const org = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM organizations WHERE id = $1`, id);
  if (!org?.length) return res.status(404).json({ error: 'Org not found' });

  const profile = await prisma.businessProfile.create({
    data: {
      name,
      city,
      category,
      created_by: userId,
      onboarding_completed: false,
      ...(full_address  ? { full_address }  : {}),
      ...(phone         ? { phone }         : {}),
      ...(website_url   ? { website_url }   : {}),
      ...(description   ? { description }   : {}),
      ...(google_place_id ? { google_place_id } : {}),
    } as any,
  });

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET organization_id = $1, branch_display_name = $2, branch_role = 'branch'
     WHERE id = $3`,
    id, branch_display_name || name, profile.id,
  );

  // Update branch count on org
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET branch_count = branch_count + 1 WHERE id = $1`, id,
  );

  // Sync new quantity to the Paddle subscription (fire-and-forget)
  syncPaddleQuantity(id).catch((e) => console.warn('[orgs] Paddle quantity sync failed:', e.message));

  return res.json({ ...profile, organization_id: id, branch_display_name });
});

// ── DELETE /api/orgs/:id/branches/:branchId ───────────────────────────────────

router.delete('/:id/branches/:branchId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, branchId } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET is_active = false WHERE id = $1 AND organization_id = $2`,
    branchId, id,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET branch_count = GREATEST(0, branch_count - 1) WHERE id = $1`, id,
  );

  // Sync reduced quantity to the Paddle subscription (fire-and-forget)
  syncPaddleQuantity(id).catch((e) => console.warn('[orgs] Paddle quantity sync failed:', e.message));

  return res.json({ ok: true });
});

export default router;
