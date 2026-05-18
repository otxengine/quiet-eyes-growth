-- OTX Architecture Migration
-- Run this once against the production PostgreSQL database to sync the schema.
-- All statements are idempotent (safe to re-run).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AutoAction — add OTX-003/004 columns to existing table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE auto_actions
  ADD COLUMN IF NOT EXISTS confidence_score    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS predicted_impact    TEXT,
  ADD COLUMN IF NOT EXISTS execution_decision  TEXT,
  ADD COLUMN IF NOT EXISTS decision_reason     TEXT,
  ADD COLUMN IF NOT EXISTS constraint_notes    TEXT,
  ADD COLUMN IF NOT EXISTS outcome_score       DOUBLE PRECISION;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SystemEvent — OTX-001 centralized event data bus
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_events (
  id              TEXT        NOT NULL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_id     TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  payload         TEXT,
  context_attrs   TEXT,
  routing_status  TEXT        NOT NULL DEFAULT 'pending',
  dispatched_to   TEXT,
  processed_at    TEXT,
  composite_id    TEXT
);

CREATE INDEX IF NOT EXISTS system_events_business_status
  ON system_events (business_id, routing_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RoutingRule — OTX-001 dynamic rule table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routing_rules (
  id            TEXT        NOT NULL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type    TEXT        NOT NULL,
  conditions    TEXT,
  target_agents TEXT        NOT NULL,
  priority      INT         NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  description   TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CompositeSignal — OTX-002 fused signal representation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS composite_signals (
  id                TEXT        NOT NULL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_id       TEXT        NOT NULL,
  signal_ids        TEXT        NOT NULL,
  fusion_type       TEXT        NOT NULL,
  composite_score   DOUBLE PRECISION,
  context           TEXT,
  candidate_actions TEXT,
  selected_action   TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending',
  scored_at         TEXT,
  weight_snapshot   TEXT
);

CREATE INDEX IF NOT EXISTS composite_signals_business_status
  ON composite_signals (business_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. BusinessConstraints — OTX-004 per-business constraint rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_constraints (
  id                       TEXT        NOT NULL PRIMARY KEY,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_id              TEXT        NOT NULL UNIQUE,
  brand_tone               TEXT,
  prohibited_keywords      TEXT,
  max_discount_pct         DOUBLE PRECISION,
  allow_competitor_mention BOOLEAN     DEFAULT FALSE,
  posting_hours_start      INT         DEFAULT 8,
  posting_hours_end        INT         DEFAULT 22,
  approved_channels        TEXT,
  budget_cap_daily_ils     DOUBLE PRECISION,
  content_policy           TEXT,
  min_confidence_auto      DOUBLE PRECISION DEFAULT 85,
  min_confidence_suggest   DOUBLE PRECISION DEFAULT 60,
  updated_at               TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seed default routing rules (OTX-001)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO routing_rules (id, event_type, conditions, target_agents, priority, is_active, description)
VALUES
  ('rule-new-review',     'new_review',       NULL, '["autoRespondToReviews","generateProactiveAlerts"]', 10, TRUE, 'Route new reviews to response agent and alert generator'),
  ('rule-hot-lead',       'hot_lead',         NULL, '["sendLeadNotification","generateProactiveAlerts"]',  10, TRUE, 'Notify on hot leads'),
  ('rule-competitor',     'competitor_change', NULL, '["runCompetitorIdentification","generateProactiveAlerts"]', 8, TRUE, 'Competitor change triggers re-analysis'),
  ('rule-market-signal',  'market_signal',    NULL, '["runMarketIntelligence","generateProactiveAlerts"]',  7, TRUE, 'Market signal triggers intelligence run'),
  ('rule-local-event',    'local_event',      NULL, '["findLocalEvents","generateProactiveAlerts"]',        6, TRUE, 'Local event detected — find opportunities'),
  ('rule-retention-risk', 'retention_risk',   NULL, '["generateProactiveAlerts","reviewRequestAutomation"]', 9, TRUE, 'Retention risk triggers alert + review request')
ON CONFLICT (id) DO NOTHING;
