-- Migration 007: Tier quota enforcement + SectorTrendRadar v2 extended columns
-- Applied: 2026-07-03

-- ── 1. sector_trends — add seasonal analysis + peak estimation columns ────────
ALTER TABLE "sector_trends"
  ADD COLUMN IF NOT EXISTS "seasonal_adjustment" NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS "days_to_peak_est"    INTEGER;

COMMENT ON COLUMN "sector_trends"."seasonal_adjustment" IS
  'Seasonal multiplicative factor (DOW+hour) applied before z-score. <1 = low-traffic slot, >1 = high-traffic slot.';
COMMENT ON COLUMN "sector_trends"."days_to_peak_est" IS
  'Estimated days until trend reaches full peak based on linear slope. NULL = already at peak or insufficient data.';

-- ── 2. api_quota_usage — daily scan counter per business ──────────────────────
CREATE TABLE IF NOT EXISTS "api_quota_usage" (
  "id"           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id"  TEXT        NOT NULL,
  "date_bucket"  TEXT        NOT NULL,   -- 'YYYY-MM-DD' UTC
  "scan_count"   INTEGER     NOT NULL DEFAULT 0,
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_quota_business_date UNIQUE ("business_id", "date_bucket")
);

CREATE INDEX IF NOT EXISTS idx_quota_business_date
  ON "api_quota_usage" ("business_id", "date_bucket");

COMMENT ON TABLE "api_quota_usage" IS
  'Durable daily scan counter per business for tier quota enforcement (free_trial=10, basic=50, premium=200/day)';

-- Enable RLS
ALTER TABLE "api_quota_usage" ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (agents + server use service role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_quota_usage' AND policyname = 'service_full_access'
  ) THEN
    CREATE POLICY "service_full_access" ON "api_quota_usage"
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Authenticated users can read their own quota
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_quota_usage' AND policyname = 'user_read_own'
  ) THEN
    CREATE POLICY "user_read_own" ON "api_quota_usage"
      FOR SELECT USING (
        "business_id" IN (
          SELECT id::TEXT FROM "businesses" WHERE owner_id = auth.uid()::TEXT
        )
      );
  END IF;
END $$;

-- ── 3. Ensure plan_id defaults ────────────────────────────────────────────────
-- business_profiles is a Prisma table, but make sure legacy rows have plan_id
UPDATE "business_profiles"
  SET "plan_id" = 'free_trial'
  WHERE "plan_id" IS NULL OR "plan_id" = '';
