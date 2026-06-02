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

    // 2. For legacy users: find BusinessProfiles with created_by but no org
    //    Auto-create an org for them so the system works seamlessly
    const userRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT email FROM users WHERE auth_id = $1 LIMIT 1`, userId,
    ).catch(() => []);
    const userEmail = userRows?.[0]?.email || '';

    const orphanProfiles = await prisma.businessProfile.findMany({
      where: {
        created_by: userEmail || undefined,
        ...(userEmail ? {} : { id: 'NEVER' }), // skip if no email
      },
    }).catch(() => []);

    // Auto-create org for orphan profiles
    for (const profile of orphanProfiles) {
      // Check if profile already linked to an org
      const linked = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM business_profiles WHERE id = $1 AND organization_id IS NOT NULL LIMIT 1`,
        profile.id,
      ).catch(() => []);
      if (linked?.length > 0) continue;

      // Check if user already has an org from memberRows
      const existingOrg = memberRows[0];
      let orgId: string;

      if (existingOrg) {
        orgId = existingOrg.id;
      } else {
        // Create org
        const newOrg = await prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO organizations (id, name, owner_user_id, is_agency, plan_id, branch_count, subscription_status, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, false, 'starter', 1, 'active', NOW())
           RETURNING *`,
          profile.name, userId,
        );
        orgId = newOrg[0].id;

        // Add owner membership
        await prisma.$executeRawUnsafe(
          `INSERT INTO organization_members (id, org_id, user_id, role, status, invited_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'owner', 'active', NOW())
           ON CONFLICT (org_id, user_id) DO NOTHING`,
          orgId, userId,
        );

        memberRows.push({ ...newOrg[0], role: 'owner', branch_ids: null });
      }

      // Link profile to org
      await prisma.$executeRawUnsafe(
        `UPDATE business_profiles SET organization_id = $1, branch_role = 'standalone' WHERE id = $2`,
        orgId, profile.id,
      );
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

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  const { user_id, email, role = 'manager', branch_ids } = req.body;
  if (!user_id && !email) return res.status(400).json({ error: 'user_id or email required' });

  const targetUserId = user_id || `invite:${email}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO organization_members (id, org_id, user_id, email, role, branch_ids, invited_by, invited_at, status)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW(), 'active')
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = $4, branch_ids = $5, status = 'active'`,
      id, targetUserId, email || null, role,
      branch_ids ? JSON.stringify(branch_ids) : null,
      userId,
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/orgs/:id/members/:memberId ────────────────────────────────────

router.patch('/:id/members/:memberId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, memberId } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  const { role, branch_ids } = req.body;
  await prisma.$executeRawUnsafe(
    `UPDATE organization_members SET role = COALESCE($1, role), branch_ids = COALESCE($2, branch_ids)
     WHERE org_id = $3 AND user_id = $4`,
    role || null, branch_ids ? JSON.stringify(branch_ids) : null, id, memberId,
  );
  return res.json({ ok: true });
});

// ── DELETE /api/orgs/:id/members/:memberId ───────────────────────────────────

router.delete('/:id/members/:memberId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, memberId } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  await prisma.$executeRawUnsafe(
    `UPDATE organization_members SET status = 'revoked' WHERE org_id = $1 AND user_id = $2`,
    id, memberId,
  );
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

// ── POST /api/orgs/:id/branches ───────────────────────────────────────────────
// Creates a new BusinessProfile linked to this org (new branch).

router.post('/:id/branches', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params as Params;

  if (!await isOrgOwnerOrAdmin(id, userId)) return res.status(403).json({ error: 'Insufficient role' });

  const { name, city, category, branch_display_name } = req.body;
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
  return res.json({ ok: true });
});

export default router;
