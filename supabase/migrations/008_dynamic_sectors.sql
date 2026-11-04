-- Migration 008: Remove hardcoded sector constraint from businesses table.
-- The original CHECK (sector IN ('restaurant','fitness','beauty','local')) blocks
-- all new business types. Replace with a permissive TEXT column.

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_sector_check;

-- Add a comment documenting the change
COMMENT ON COLUMN businesses.sector IS
  'Business sector key. Previously constrained to 4 values; now open to any string matching the sector_key in business_profiles.sector_profile JSON.';
