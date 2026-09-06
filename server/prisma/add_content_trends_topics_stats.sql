-- Safe to re-run on an already-created table.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS outlier_topics TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS outlier_stats TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS content_trends_topics TEXT;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS content_trends_stats TEXT;
