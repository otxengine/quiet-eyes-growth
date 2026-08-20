-- Facebook's scraped "bio" is often just Facebook's own auto-generated page summary
-- ("{N} likes · {M} were here. {category}"), which duplicates follower_count/category
-- we already store — but it's the only place the check-in count and last-post date show
-- up. Pull those two out into real columns so the UI can show genuine signal (activity/
-- staleness) instead of rendering that boilerplate text as if it were a real bio.
-- Facebook-only for now; null for Instagram/TikTok rows. Safe to re-run.
ALTER TABLE business_social_profiles ADD COLUMN IF NOT EXISTS checkin_count INTEGER;
ALTER TABLE business_social_profiles ADD COLUMN IF NOT EXISTS last_post_at TIMESTAMP;
ALTER TABLE competitor_social_profiles ADD COLUMN IF NOT EXISTS checkin_count INTEGER;
ALTER TABLE competitor_social_profiles ADD COLUMN IF NOT EXISTS last_post_at TIMESTAMP;
