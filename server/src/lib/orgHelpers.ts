import { prisma } from '../db';

/**
 * Ensures a BusinessProfile is linked to an organization, creating one if needed.
 * Reuses the user's existing org when they already have one; otherwise creates a
 * new org seeded with `planId` (defaults to 'starter' to match legacy behavior).
 */
export async function getOrCreateOrgForProfile(
  profile: { id: string; name: string },
  userId: string,
  planId: string = 'starter',
): Promise<string> {
  const linked = await prisma.$queryRawUnsafe<any[]>(
    `SELECT organization_id FROM business_profiles WHERE id = $1 AND organization_id IS NOT NULL LIMIT 1`,
    profile.id,
  ).catch(() => []);
  if (linked?.[0]?.organization_id) return linked[0].organization_id;

  const existingOrgRows = await prisma.$queryRawUnsafe<any[]>(
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
       VALUES (gen_random_uuid()::text, $1, $2, false, $3, 1, 'active', NOW())
       RETURNING id`,
      profile.name, userId, planId,
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
