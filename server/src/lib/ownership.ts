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
        try {
          const branchIds: string[] = JSON.parse(m.branch_ids);
          branchIds.forEach(id => ids.add(id));
          continue;
        } catch { /* malformed branch_ids — fall through to full-org access */ }
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
