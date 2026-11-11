import { prisma } from '../db';

/**
 * Ensures a BusinessProfile is linked to an organization, creating one if needed.
 * Reuses the user's existing org when they already have one; otherwise creates a
 * new org seeded with `planId` (defaults to 'starter' to match legacy behavior).
 *
 * `dedicated`: the business gets an org of its own and never joins (or stays in) one that holds
 * other businesses. A report-only business is billed separately — its subscription must not be
 * the user's app subscription, and a Paddle webhook writes the plan to every business in the org.
 * A dedicated org starts with no plan: the plan arrives with the first paid webhook.
 */
export async function getOrCreateOrgForProfile(
  profile: { id: string; name: string },
  userId: string,
  planId: string = 'starter',
  { dedicated = false }: { dedicated?: boolean } = {},
): Promise<string> {
  const linked = await prisma.$queryRawUnsafe<any[]>(
    `SELECT organization_id FROM business_profiles WHERE id = $1 AND organization_id IS NOT NULL LIMIT 1`,
    profile.id,
  ).catch(() => []);
  if (linked?.[0]?.organization_id) {
    if (!dedicated) return linked[0].organization_id;
    const others = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS n FROM business_profiles WHERE organization_id = $1 AND id <> $2`,
      linked[0].organization_id, profile.id,
    );
    if (!others?.[0]?.n) return linked[0].organization_id; // already alone in its org
    // Shares an org with other businesses: falls through to an org of its own.
  }

  const existingOrgRows = dedicated ? [] : await prisma.$queryRawUnsafe<any[]>(
    `SELECT o.id FROM organizations o
     JOIN organization_members om ON om.org_id = o.id
     WHERE om.user_id = $1 AND om.status = 'active'
     ORDER BY o.created_at ASC LIMIT 1`,
    userId,
  ).catch(() => []);

  let orgId: string;
  if (existingOrgRows?.[0]?.id) {
    orgId = existingOrgRows[0].id;
  } else {
    const newOrg = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO organizations (id, name, owner_user_id, is_agency, plan_id, branch_count, subscription_status, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, false, $3, 1, $4, NOW())
       RETURNING id`,
      profile.name, userId, dedicated ? 'brief_free' : planId, dedicated ? 'none' : 'active',
    );
    orgId = newOrg[0].id;

    await prisma.$executeRawUnsafe(
      `INSERT INTO organization_members (id, org_id, user_id, role, status, invited_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'owner', 'active', NOW())
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      orgId, userId,
    );
  }

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET organization_id = $1, branch_role = 'standalone' WHERE id = $2`,
    orgId, profile.id,
  );

  return orgId;
}
