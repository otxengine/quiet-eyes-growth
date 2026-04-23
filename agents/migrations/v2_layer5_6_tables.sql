-- OTXEngine v2 — Layer 5 & 6 Tables Migration
-- Run: psql $DATABASE_URL -f migrations/v2_layer5_6_tables.sql

-- pgvector required for synthetic_personas.embedding_vector
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Table 12: hyper_local_events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hyper_local_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID        NOT NULL REFERENCES businesses(id),
  event_name           TEXT        NOT NULL,
  event_type           TEXT        NOT NULL CHECK (event_type IN ('concert','sports','roadwork','market','festival','other')),
  venue_name           TEXT,
  distance_meters      INT         NOT NULL,
  event_datetime       TIMESTAMPTZ NOT NULL,
  expected_attendance  INT,
  digital_signal_match TEXT,
  action_window_start  TIMESTAMPTZ,
  action_window_end    TIMESTAMPTZ,
  source_url           TEXT        NOT NULL,
  detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score     NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_hyperlocal_biz_date
  ON hyper_local_events(business_id, event_datetime);

-- ── Table 13: demand_forecasts ────────────────────────────────────────────────
-- UNIQUE on (business_id, forecast_date, COALESCE(hour_of_day,-1)) so that
-- day-level rows (hour_of_day = NULL) are also de-duplicated.
CREATE TABLE IF NOT EXISTS demand_forecasts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID        NOT NULL REFERENCES businesses(id),
  forecast_date         DATE        NOT NULL,
  hour_of_day           INT         CHECK (hour_of_day BETWEEN 0 AND 23),
  demand_index          NUMERIC(5,2),
  demand_delta_pct      NUMERIC(5,2),
  contributing_factors  JSONB,
  weather_condition     TEXT,
  local_event_id        UUID        REFERENCES hyper_local_events(id),
  confidence_score      NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url            TEXT        NOT NULL DEFAULT 'internal://demand-forecaster'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_biz_date_hour
  ON demand_forecasts(business_id, forecast_date, COALESCE(hour_of_day, -1));

-- ── Table 14: resource_arbitrage_actions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_arbitrage_actions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID        NOT NULL REFERENCES businesses(id),
  trigger_type         TEXT        NOT NULL CHECK (trigger_type IN ('low_demand','weather','competitor_gap','inventory')),
  trigger_description  TEXT        NOT NULL,
  recommended_action   TEXT        NOT NULL,
  action_type          TEXT        NOT NULL CHECK (action_type IN ('promotion','coupon','menu_change','staffing','delivery_push')),
  target_segment       TEXT,
  expected_uplift_pct  NUMERIC(5,2),
  valid_from           TIMESTAMPTZ NOT NULL,
  valid_until          TIMESTAMPTZ NOT NULL,
  executed             BOOLEAN     DEFAULT FALSE,
  source_url           TEXT        NOT NULL,
  detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score     NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

-- ── Table 15: cross_sector_signals ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cross_sector_signals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sector           TEXT        NOT NULL,
  target_sector           TEXT        NOT NULL,
  trend_description       TEXT        NOT NULL,
  correlation_score       NUMERIC(3,2),
  lag_days                INT,
  opportunity_description TEXT,
  source_signal_ids       UUID[],
  source_url              TEXT        NOT NULL,
  detected_at_utc         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score        NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_cross_sector
  ON cross_sector_signals(source_sector, target_sector, detected_at_utc DESC);

-- ── Table 16: synthetic_personas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS synthetic_personas (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID        NOT NULL REFERENCES businesses(id),
  persona_name             TEXT        NOT NULL,
  demographic_profile      JSONB       NOT NULL,
  behavioral_traits        JSONB       NOT NULL,
  osint_basis              TEXT[],
  simulated_conversion_rate NUMERIC(4,3),
  simulated_response       JSONB,
  embedding_vector         vector(1536),
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url               TEXT        NOT NULL DEFAULT 'internal://persona-simulator'
);

-- ── Table 17: meta_configurations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_configurations (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             UUID    NOT NULL REFERENCES businesses(id) UNIQUE,
  sector                  TEXT    NOT NULL,
  auto_detected_kpis      JSONB   NOT NULL,
  signal_keywords         TEXT[]  NOT NULL,
  trend_thresholds        JSONB   NOT NULL,
  competitor_search_terms TEXT[],
  local_radius_meters     INT     DEFAULT 500,
  configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  configuration_version   INT     DEFAULT 1
);

-- ── Integrity check ───────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name IN (
      'hyper_local_events','demand_forecasts','resource_arbitrage_actions',
      'cross_sector_signals','synthetic_personas','meta_configurations'
    )) = 6,
  'Migration incomplete — not all 6 tables created';
  RAISE NOTICE 'OTXEngine v2 migration: all 6 tables verified OK';
END $$;
