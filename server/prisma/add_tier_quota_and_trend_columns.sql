-- Migration: Tier quota enforcement + sector_trends extended columns
-- Run: psql $DATABASE_URL -f this_file.sql

-- ── 1. sector_trends — add seasonal and peak-estimate columns ─────────────────
ALTER TABLE "sector_trends"
  ADD COLUMN IF NOT EXISTS "seasonal_adjustment" FLOAT,
  ADD COLUMN IF NOT EXISTS "days_to_peak_est"    INTEGER;

COMMENT ON COLUMN "sector_trends"."seasonal_adjustment" IS
  'Seasonal multiplicative factor (DOW+hour) applied before z-score computation';
COMMENT ON COLUMN "sector_trends"."days_to_peak_est" IS
  'Estimated days until full trend peak, based on linear slope of daily aggregates';

-- ── 2. api_quota_usage — daily scan counter per business ──────────────────────
-- Used as durable fallback if the server restarts; in-process Map is primary.
CREATE TABLE IF NOT EXISTS "api_quota_usage" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "business_id"  TEXT NOT NULL,
  "date_bucket"  TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  "scan_count"   INTEGER NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("business_id", "date_bucket")
);

CREATE INDEX IF NOT EXISTS idx_quota_business_date
  ON "api_quota_usage" ("business_id", "date_bucket");

COMMENT ON TABLE "api_quota_usage" IS
  'Durable daily scan counter per business for tier quota enforcement';

-- ── 3. business_profiles — ensure plan_id has correct default ─────────────────
-- (field exists in schema, just ensuring it is set on all rows)
UPDATE "business_profiles"
  SET "plan_id" = 'free_trial'
  WHERE "plan_id" IS NULL OR "plan_id" = '';
