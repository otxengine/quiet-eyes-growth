-- OTXEngine — Migration 011
-- competitor_config + competitor_changes (both genuinely missing in production —
-- verified via information_schema.tables against the live project, not assumed
-- from agents/migrations/v4_competitor_config.sql, which assumed competitor_changes
-- already existed and only needed ALTERs; it doesn't exist at all) plus RLS.
-- Every current reader/writer uses the service_role client and bypasses RLS,
-- so RLS here is defense-in-depth, not a functional dependency.
--
-- Note: agent_data_bus already exists in production with a different, simpler
-- schema (id/event_type/source_agent/payload/status/created_at) serving other
-- agents (batchSnapshotCompetitors, analyzeCompetitorSocial) — intentionally
-- not touched by this migration. collectOTXCompetitorChanges.ts was updated to
-- write in that real shape instead of assuming a different one.

-- ─── 1. competitor_changes (base schema, formerly assumed to already exist) ────

CREATE TABLE IF NOT EXISTS competitor_changes (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID    NOT NULL REFERENCES businesses(id),
  competitor_name  TEXT,
  change_type      TEXT    CHECK (change_type IN ('price','website','social','reviews')),
  change_summary   TEXT,
  detected_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url       TEXT    NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- ─── 2. competitor_config — stores per-business competitor tracking config ──────

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

-- ─── 3. Social / engagement columns on competitor_changes ──────────────────────

ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS social_platform TEXT
    CHECK (social_platform IN ('instagram','facebook','tiktok','google','website'));

ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS post_url TEXT;

ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS sentiment TEXT
    CHECK (sentiment IN ('positive','neutral','negative'));

ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS engagement_count INT;

ALTER TABLE competitor_changes
  ADD COLUMN IF NOT EXISTS content_excerpt TEXT;

-- ─── 4. Indices ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_competitor_changes_platform
  ON competitor_changes (business_id, social_platform, detected_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_changes_business
  ON competitor_changes (business_id, detected_at_utc DESC);

-- ─── 5. Updated-at trigger for competitor_config ─────────────────────────────

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

-- ─── 6. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE competitor_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_config  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_competitor_changes ON competitor_changes;
CREATE POLICY tenant_isolation_competitor_changes ON competitor_changes
  USING (business_id = auth.uid()::uuid);

DROP POLICY IF EXISTS tenant_isolation_competitor_config ON competitor_config;
CREATE POLICY tenant_isolation_competitor_config ON competitor_config
  USING (business_id = auth.uid()::uuid);

-- ─── 7. Verify ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'competitor_changes') = 1,
    'competitor_changes table not created';

  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'competitor_config') = 1,
    'competitor_config table not created';

  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'competitor_changes' AND column_name = 'social_platform') = 1,
    'social_platform column missing from competitor_changes';

  RAISE NOTICE '011_competitor_config migration OK';
END;
$$;
