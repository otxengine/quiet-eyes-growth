-- Migration v7: SectorTrendRadar extended columns + quota tracking table
-- Run via Supabase SQL editor or: deno run agents/migrations/run_v2.ts v7_trend_radar_extended.sql

-- ── sector_trends — seasonal & peak-estimate columns ──────────────────────────
ALTER TABLE "sector_trends"
  ADD COLUMN IF NOT EXISTS "seasonal_adjustment" FLOAT,
  ADD COLUMN IF NOT EXISTS "days_to_peak_est"    INTEGER;

COMMENT ON COLUMN "sector_trends"."seasonal_adjustment" IS
  'Seasonal multiplicative factor (DOW+hour) before z-score. <1 = low-traffic slot, >1 = high-traffic slot.';

COMMENT ON COLUMN "sector_trends"."days_to_peak_est" IS
  'Estimated days until trend reaches full peak (linear slope of daily aggregates). NULL = already at peak or insufficient data.';

-- ── api_quota_usage — daily scan counter per business ──────────────────────────
CREATE TABLE IF NOT EXISTS "api_quota_usage" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id"  TEXT NOT NULL,
  "date_bucket"  TEXT NOT NULL,     -- 'YYYY-MM-DD' in UTC
  "scan_count"   INTEGER NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_quota_business_date UNIQUE ("business_id", "date_bucket")
);

CREATE INDEX IF NOT EXISTS idx_quota_business_date
  ON "api_quota_usage" ("business_id", "date_bucket");

-- Enable RLS (service-role bypasses automatically)
ALTER TABLE "api_quota_usage" ENABLE ROW LEVEL SECURITY;

-- Admins + service role can manage all; users see only their own
CREATE POLICY IF NOT EXISTS "service_full_access" ON "api_quota_usage"
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "user_read_own" ON "api_quota_usage"
  FOR SELECT USING (
    "business_id" = (
      SELECT id::TEXT FROM "business_profiles" WHERE owner_id = auth.uid()::TEXT LIMIT 1
    )
  );
