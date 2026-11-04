-- ============================================================
-- OTXEngine — Phase 1.1: Core table definitions
-- Execute in order; do NOT proceed to agents until all succeed
-- ============================================================

-- Table 1: businesses (tenant root)
CREATE TABLE IF NOT EXISTS businesses (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  sector      TEXT    NOT NULL CHECK (sector IN ('restaurant','fitness','beauty','local')),
  geo_city    TEXT    NOT NULL,
  price_tier  TEXT    CHECK (price_tier IN ('budget','mid','premium')),
  onboarded_at TIMESTAMPTZ DEFAULT now()
);

-- Table 2: otx_business_profiles (embedding-backed OTX profile — renamed to avoid conflict with Prisma BusinessProfile model)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS otx_business_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sector           TEXT,
  geo              TEXT,
  price_tier       TEXT,
  keywords         TEXT[],
  embedding_vector VECTOR(1536),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  version          INT DEFAULT 1
);

-- Table 3: signals_raw (Layer 1 ingestion)
CREATE TABLE IF NOT EXISTS signals_raw (
  signal_id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID    NOT NULL REFERENCES businesses(id),
  source_type      TEXT    NOT NULL CHECK (source_type IN ('social','forum','trend')),
  source_url       TEXT    NOT NULL,
  raw_text         TEXT    NOT NULL,
  geo              TEXT,
  detected_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- Table 4: classified_signals (Layer 2 interpretation)
CREATE TABLE IF NOT EXISTS classified_signals (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id          UUID    NOT NULL REFERENCES signals_raw(signal_id),
  business_id        UUID    NOT NULL REFERENCES businesses(id),
  intent_score       NUMERIC(3,2),
  sector_match_score NUMERIC(3,2),
  geo_match_score    NUMERIC(3,2),
  qualified          BOOLEAN DEFAULT FALSE,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url         TEXT    NOT NULL,
  confidence_score   NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- Table 5: sector_trends (Z-score spike detection)
CREATE TABLE IF NOT EXISTS sector_trends (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sector           TEXT    NOT NULL,
  geo              TEXT,
  z_score          NUMERIC(5,2),
  rolling_mean     NUMERIC,
  rolling_std      NUMERIC,
  spike_detected   BOOLEAN DEFAULT FALSE,
  detected_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url       TEXT    NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- Table 6: events_raw (Israeli calendar + Eventbrite)
CREATE TABLE IF NOT EXISTS events_raw (
  event_id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name       TEXT    NOT NULL,
  event_date       DATE    NOT NULL,
  geo              TEXT,
  source_url       TEXT    NOT NULL,
  detected_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.80 CHECK (confidence_score BETWEEN 0 AND 1),
  UNIQUE (event_name, event_date, geo)
);

-- Table 7: event_opportunities (event × business scoring)
CREATE TABLE IF NOT EXISTS event_opportunities (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID    NOT NULL REFERENCES events_raw(event_id),
  business_id        UUID    NOT NULL REFERENCES businesses(id),
  impact_score       NUMERIC(3,2),
  sector_relevance   NUMERIC(3,2),
  geo_relevance      NUMERIC(3,2),
  historical_weight  NUMERIC(3,2),
  source_url         TEXT    NOT NULL,
  confidence_score   NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- Table 8: competitor_changes (diff-based, only write on actual change)
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

-- Table 9: actions_recommended (decision layer output)
CREATE TABLE IF NOT EXISTS actions_recommended (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID    NOT NULL REFERENCES businesses(id),
  action_score       NUMERIC(4,3) NOT NULL CHECK (action_score BETWEEN 0 AND 1),
  action_type        TEXT    NOT NULL CHECK (action_type IN ('promote','respond','alert','hold')),
  expires_at         TIMESTAMPTZ DEFAULT (now() + INTERVAL '2 hours'),
  source_ids         UUID[],
  stale_memory_flag  BOOLEAN DEFAULT FALSE,
  source_url         TEXT    NOT NULL,
  confidence_score   NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 10: global_memory_aggregates (cross-tenant learning)
-- No RLS — shared read-only aggregate layer
CREATE TABLE IF NOT EXISTS global_memory_aggregates (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agg_type      TEXT    NOT NULL CHECK (agg_type IN ('global','sector','geo','price_tier')),
  dimension_key TEXT    NOT NULL,
  action_type   TEXT    NOT NULL,
  success_rate  NUMERIC(4,3),
  sample_size   INT,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_valid      BOOLEAN DEFAULT TRUE
);

-- Table 11: agent_heartbeat (system health)
CREATE TABLE IF NOT EXISTS agent_heartbeat (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name          TEXT    NOT NULL,
  last_ping_utc       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ingestion_utc  TIMESTAMPTZ,
  status              TEXT    NOT NULL CHECK (status IN ('OK','DELAYED','ERROR')),
  error_message       TEXT
);
