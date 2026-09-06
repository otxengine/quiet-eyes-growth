-- Safe to re-run on an already-created table.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS own_reviews_pillar_stats TEXT;
