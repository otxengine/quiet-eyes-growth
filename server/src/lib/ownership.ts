import { prisma } from '../db';

/**
 * Shared ownership resolution — used by both the entity CRUD router
 * (server/src/routes/entities.ts) and the business-scoped function
 * dispatcher (server/src/middleware/businessAccess.ts) so the two
 * enforcement points can never drift apart.
 */

// ── Clerk email lookup cache ───────────────────────────────────────────────────
// Maps userId → email, TTL 10 minutes. Avoids repeated Clerk API calls.
const _emailCache = new Map<string, { email: string; expires: number }>();

export async function getUserEmail(userId: string): Promise<string | null> {
  const cached = _emailCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.email;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY || '';
    if (!secretKey || secretKey.includes('your_key_here')) return null;
    const { createClerkClient } = require('@clerk/express');
    const cc = createClerkClient({ secretKey });
    const user = await cc.users.getUser(userId);
    const email = user?.emailAddresses?.[0]?.emailAddress || null;
    if (email) _emailCache.set(userId, { email, expires: Date.now() + 10 * 60_000 });
    return email;
  } catch {
    return null;
  }
}

// ── Organization roles ─────────────────────────────────────────────────────────
// The roles src/pages/OrganizationSettings.jsx knows. `manager` is the legacy
// branch manager: its branch_ids limit which branches it reaches.
export const ORG_ROLES = new Set(['owner', 'admin', 'manager', 'content_editor', 'viewer']);
// Manage the org (members, branches, billing). Only an owner may grant, change or revoke these.
export const ORG_ADMIN_ROLES = new Set(['owner', 'admin']);
// May change business data. viewer, and any role not listed, is read-only.
const WRITE_ROLES = new Set(['owner', 'admin', 'manager', 'content_editor']);

/**
 * Every businessProfileId a user can access, with the role it is reached
 * through — as the direct creator (owner), via the admin-created fallback
 * (created_by stores an email), or as an active member of an organization
 * that owns the branch (see server/src/routes/organizations.ts for the same
 * org/branch model). A business reached more than one way keeps a role that
 * can write, if any.
 */
export async function getUserBusinessRoles(userId: string): Promise<Map<string, string>> {
  const roles = new Map<string, string>();
  const add = (id: string, role: string) => {
    if (!roles.has(id) || (WRITE_ROLES.has(role) && !WRITE_ROLES.has(roles.get(id)!))) roles.set(id, role);
  };

  const byId = await prisma.businessProfile.findMany({
    where: { created_by: userId },
    select: { id: true },
  });
  byId.forEach(p => add(p.id, 'owner'));

  if (byId.length === 0) {
    const email = await getUserEmail(userId);
    if (email) {
      const byEmail = await prisma.businessProfile.findMany({
        where: { created_by: email },
        select: { id: true },
      });
      byEmail.forEach(p => add(p.id, 'owner'));
    }
  }

  // Organization membership — multi-branch / agency accounts (raw SQL: these
  // tables aren't in the Prisma schema yet, same pattern as organizations.ts).
  try {
    const memberships = await prisma.$queryRawUnsafe<any[]>(
      `SELECT org_id, role, branch_ids FROM organization_members WHERE user_id = $1 AND status = 'active'`,
      userId,
    );
    for (const m of memberships) {
      if (m.role === 'manager' && m.branch_ids) {
        let branchIds: unknown = null;
        try { branchIds = JSON.parse(m.branch_ids); } catch { /* malformed: no branches (fail closed) */ }
        if (Array.isArray(branchIds) && branchIds.length) {
          // branch_ids is whatever the inviter sent, so only keep branches this org really owns.
          const own = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id FROM business_profiles WHERE organization_id = $1 AND id = ANY($2::text[])`,
            m.org_id, branchIds.map(String),
          );
          own.forEach(b => add(b.id, m.role));
        }
        continue;
      }
      const branches = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM business_profiles WHERE organization_id = $1`,
        m.org_id,
      );
      branches.forEach(b => add(b.id, m.role));
    }
  } catch { /* organization tables unavailable (e.g. older env) — direct ownership above still applies */ }

  return roles;
}

/** Every businessProfileId a user can read. */
export async function getUserBusinessIds(userId: string): Promise<string[]> {
  return Array.from((await getUserBusinessRoles(userId)).keys());
}

/** The businessProfileIds a user can change: all of getUserBusinessIds except those reached only as a viewer. */
export async function getUserWritableBusinessIds(userId: string): Promise<string[]> {
  return Array.from(await getUserBusinessRoles(userId))
    .filter(([, role]) => WRITE_ROLES.has(role))
    .map(([id]) => id);
}
