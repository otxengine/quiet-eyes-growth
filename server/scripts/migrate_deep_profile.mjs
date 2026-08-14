// Migration: add business_deep_profile column + remove sector CHECK constraint
// Run via: railway run node server/scripts/migrate_deep_profile.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MIGRATIONS = [
  // 1. Add business_deep_profile column to business_profiles
  `ALTER TABLE business_profiles
     ADD COLUMN IF NOT EXISTS business_deep_profile TEXT`,

  // 2. Remove the hardcoded sector CHECK constraint from businesses (Supabase table)
  //    This allows any sector_key — not just the original 4
  `ALTER TABLE businesses
     DROP CONSTRAINT IF EXISTS businesses_sector_check`,
];

async function main() {
  console.log('[migrate] Running deep_profile migrations...\n');

  for (const sql of MIGRATIONS) {
    const label = sql.trim().split('\n')[0].slice(0, 80);
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('  ✓', label);
    } catch (e) {
      // Column already exists or constraint already gone — safe to ignore
      if (
        e.message?.includes('already exists') ||
        e.message?.includes('does not exist')
      ) {
        console.log('  ~ (already applied):', label);
      } else {
        console.error('  ✗ FAILED:', label);
        console.error('    ', e.message);
      }
    }
  }

  // Verify
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'business_profiles' AND column_name = 'business_deep_profile'
  `);
  const added = cols.length > 0;
  console.log(`\n[migrate] business_deep_profile column: ${added ? '✓ EXISTS' : '✗ MISSING'}`);

  await prisma.$disconnect();
  process.exit(added ? 0 : 1);
}

main().catch(e => {
  console.error('[migrate] Fatal error:', e.message);
  process.exit(1);
});
