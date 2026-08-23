-- Safe to re-run on an already-created table.
ALTER TABLE competitor_social_profiles ADD COLUMN IF NOT EXISTS raw_data TEXT;
