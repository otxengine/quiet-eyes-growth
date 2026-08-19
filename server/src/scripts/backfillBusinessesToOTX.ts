/**
 * One-time backfill: sync every already-approved BusinessProfile into the
 * Supabase OTX `businesses` table. Needed because syncBusinessToOTX() only
 * runs going forward from approve-about — existing approved businesses were
 * never synced, which is why the OTX competitor-changes pipeline has been
 * processing zero businesses in production.
 *
 * Run once, against production env (DATABASE_URL/DIRECT_URL + SUPABASE_URL/
 * SUPABASE_SERVICE_ROLE_KEY set): npx ts-node src/scripts/backfillBusinessesToOTX.ts
 */
import { prisma } from '../db';
import { syncBusinessToOTX } from '../lib/syncBusinessToOTX';

function sectorKeyOf(sectorProfileJson: string | null): string {
  try { return JSON.parse(sectorProfileJson ?? '{}')?.sector_key || 'other'; } catch { return 'other'; }
}

async function main() {
  const approved = await prisma.businessProfile.findMany({ where: { about_status: 'approved' } });
  console.log(`Backfilling ${approved.length} approved businesses into OTX...`);
  for (const b of approved) {
    await syncBusinessToOTX(b.id, b.name, sectorKeyOf(b.sector_profile), b.city);
  }
  console.log('Done.');
}

main().finally(() => prisma.$disconnect());
