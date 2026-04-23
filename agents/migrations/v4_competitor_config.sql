-- OTXEngine Migration v4: competitor_config table + social columns on competitor_changes
-- Run ONCE on the OTX Supabase project

-- ─── 1. competitor_config — stores per-business competitor tracking config ──────

CREATE TABLE IF NOT EXISTS competitor_config (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  competitor_name    TEXT NOT NULL,
  website_url        TEXT,
  google_place_id    TEXT,
  instagram_handle   TEXT,   -- e.g. "@gymname"
  facebook_page_id   TEXT,   -- numeric page ID or slug
  tiktok_handle      TEXT,   -- e.g. "@gymname"
  apify_actor_id     TEXT,   -- optional custom Apify actor override
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  discovered_by      TEXT    DEFAULT 'manual',  -- 'manual' | 'serp_auto' | 'anthropic'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (business_id, competitor_name)
);

CREATE INDEX IF NOT EXISTS idx_competitor_config_business
  ON competitor_config (business_id)
  WHERE is_active = TRUE;

-- ─── 2. ALTER competitor_changes — add social / engagement columns ──────────────

-- Social platform identifier
ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS social_platform TEXT
    CHECK (social_platform IN ('instagram','facebook','tiktok','google','website'));

-- Direct link to the changed post / listing / page
ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS post_url TEXT;

-- Sentiment of the content detected (for social posts / reviews)
ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS sentiment TEXT
    CHECK (sentiment IN ('positive','neutral','negative'));

-- Engagement snapshot at detection time
ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS engagement_count INT;

-- Raw excerpt / caption (first 500 chars)
ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS content_excerpt TEXT;

-- ─── 3. Index for quick platform-filtered queries ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_competitor_changes_platform
  ON competitor_changes (business_id, social_platform, detected_at_utc DESC);

-- ─── 4. Updated-at trigger for competitor_config ─────────────────────────────

CREATE OR REPLACE FUNCTION update_competitor_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competitor_config_updated_at ON competitor_config;
CREATE TRIGGER trg_competitor_config_updated_at
  BEFORE UPDATE ON competitor_config
  FOR EACH ROW EXECUTE FUNCTION update_competitor_config_updated_at();

-- ─── 5. Verify ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'competitor_config') = 1,
    'competitor_config table not created';

  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'competitor_changes' AND column_name = 'social_platform') = 1,
    'social_platform column missing from competitor_changes';

  RAISE NOTICE 'v4_competitor_config migration OK';
END;
$$;
