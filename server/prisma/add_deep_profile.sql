-- Migration: add business_deep_profile to business_profiles
-- Stores scraped intelligence from website + social URLs

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS business_deep_profile TEXT;

-- Index for quick existence check (is the column populated?)
CREATE INDEX IF NOT EXISTS idx_bp_deep_profile_not_null
  ON business_profiles ((business_deep_profile IS NOT NULL));
