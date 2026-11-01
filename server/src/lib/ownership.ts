import { prisma } from '../db';
import { createLogger } from '../infra/logger';

const logger = createLogger('ownership');

/**
 * Shared ownership resolution — used by both the entity CRUD router
 * (server/src/routes/entities.ts) and the business-scoped function
 * dispatcher (server/src/middleware/businessAccess.ts) so the two
 * enforcement points can never drift apart.
 */

// ── Clerk email lookup cache ───────────────────────────────────────────────────
// Maps userId → email (null too, so unverified users don't hit Clerk on every
// check), TTL 10 minutes. Avoids repeated Clerk API calls.
const _emailCache = new Map<string, { email: string | null; expires: number }>();

/**
 * The user's primary email, only once Clerk has verified it; otherwise null.
 * Callers grant access by this address (admin-created created_by, owner_email),
 * so it must be one the user has proven they control.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  const cached = _emailCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.email;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY || '';
    if (!secretKey || secretKey.includes('your_key_here')) return null;
    const { createClerkClient } = require('@clerk/express');
    const cc = createClerkClient({ secretKey });
    const user = await cc.users.getUser(userId);
    const primary = user?.emailAddresses?.find((a: any) => a.id === user.primaryEmailAddressId);
    const email: string | null = primary?.verification?.status === 'verified' ? primary.emailAddress : null;
    _emailCache.set(userId, { email, expires: Date.now() + 10 * 60_000 });
    return email;
  } catch {
    return null;
  }
}

/**
 * Returns all businessProfileIds a user can access — as the direct creator,
 * via the admin-created fallback (created_by stores an email), or as an
 * active member of an organization that owns the branch (see
 * server/src/routes/organizations.ts for the same org/branch model).
 */
export async function getUserBusinessIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();

  const byId = await prisma.businessProfile.findMany({
    where: { created_by: userId },
    select: { id: true },
  });
  byId.forEach(p => ids.add(p.id));

  if (byId.length === 0) {
    const email = await getUserEmail(userId);
    if (email) {
      const byEmail = await prisma.businessProfile.findMany({
        where: { created_by: email },
        select: { id: true },
      });
      byEmail.forEach(p => ids.add(p.id));
      // Claim them for this Clerk id on first match, so the email path runs once:
      // ownership stops depending on the address, and the profile shows up in
      // GET /entities/BusinessProfile (which lists by created_by = userId only).
      if (byEmail.length) {
        await prisma.businessProfile.updateMany({ where: { created_by: email }, data: { created_by: userId } })
          .catch(err => logger.warn('email→userId ownership claim failed', { userId, error: String(err) }));
      }
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
          own.forEach(b => ids.add(b.id));
        }
        continue;
      }
      const branches = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM business_profiles WHERE organization_id = $1`,
        m.org_id,
      );
      branches.forEach(b => ids.add(b.id));
    }
  } catch { /* organization tables unavailable (e.g. older env) — direct ownership above still applies */ }

  return Array.from(ids);
}
