/**
 * OTXEngine v7 Migration Runner
 * Applies: sector_trends extended columns + api_quota_usage table
 *
 * Run: deno run --allow-net --allow-env --allow-read agents/migrations/run_v7.ts
 */

import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const DB_URL = "postgresql://postgres:sTBQ92DfuGzvCLaD@db.mvywtnjptbpxvmoldrxe.supabase.co:5432/postgres";

const MIGRATION = `
-- 1. sector_trends — seasonal + peak columns
ALTER TABLE "sector_trends"
  ADD COLUMN IF NOT EXISTS "seasonal_adjustment" NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS "days_to_peak_est"    INTEGER;

-- 2. api_quota_usage table
CREATE TABLE IF NOT EXISTS "api_quota_usage" (
  "id"           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id"  TEXT        NOT NULL,
  "date_bucket"  TEXT        NOT NULL,
  "scan_count"   INTEGER     NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_quota_business_date UNIQUE ("business_id", "date_bucket")
);

CREATE INDEX IF NOT EXISTS idx_quota_business_date
  ON "api_quota_usage" ("business_id", "date_bucket");

ALTER TABLE "api_quota_usage" ENABLE ROW LEVEL SECURITY;

-- 3. plan_id defaults
UPDATE "business_profiles"
  SET "plan_id" = 'free_trial'
  WHERE "plan_id" IS NULL OR "plan_id" = '';
`;

async function run() {
  console.log("🔄 OTXEngine v7 Migration — connecting to Supabase...");
  const client = new Client(DB_URL);
  try {
    await client.connect();
    console.log("✅ Connected");

    // Split on statement boundaries and run each
    const stmts = MIGRATION.split(";").map(s => s.trim()).filter(s => s.length > 10);
    for (const stmt of stmts) {
      const label = stmt.substring(0, 80).replace(/\n/g, " ");
      try {
        await client.queryArray(stmt);
        console.log(`  ✅ ${label}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Already-exists errors are OK
        if (msg.includes("already exists") || msg.includes("duplicate")) {
          console.log(`  ⚠️  Already exists (skip): ${label}`);
        } else {
          console.error(`  ❌ FAILED: ${label}\n     ${msg}`);
          throw e;
        }
      }
    }

    // Verify
    const { rows: trendCols } = await client.queryArray(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sector_trends'
      AND column_name IN ('seasonal_adjustment', 'days_to_peak_est')
    `);
    const { rows: quotaTable } = await client.queryArray(`
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_name = 'api_quota_usage'
    `);
    console.log(`\n📊 sector_trends new columns: ${trendCols.length}/2`);
    console.log(`📊 api_quota_usage table exists: ${quotaTable[0]?.[0] === "1" || quotaTable[0]?.[0] === 1 ? "✅" : "❌"}`);
    console.log("\n✅ Migration v7 complete.");
  } finally {
    await client.end();
  }
}

await run();
