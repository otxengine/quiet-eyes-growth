-- ============================================================
-- OTX Engine v2 — Full Migration
-- Run once against your Supabase/PostgreSQL database.
-- All statements use IF NOT EXISTS — safe to re-run.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Ingestion / Intelligence tables ──────────────────────────

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

-- ── Prediction tables ─────────────────────────────────────────

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
  confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (confidence_score BETWEEN 0 AND 1),
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url            TEXT        NOT NULL DEFAULT 'internal://demand-forecaster'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_biz_date_hour
  ON demand_forecasts(business_id, forecast_date, COALESCE(hour_of_day, -1));

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
  confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (confidence_score BETWEEN 0 AND 1)
);

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
  confidence_score        NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (confidence_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_cross_sector
  ON cross_sector_signals(source_sector, target_sector, detected_at_utc DESC);

CREATE TABLE IF NOT EXISTS synthetic_personas (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID        NOT NULL REFERENCES businesses(id),
  persona_name              TEXT        NOT NULL,
  demographic_profile       JSONB       NOT NULL DEFAULT '{}',
  behavioral_traits         JSONB       NOT NULL DEFAULT '{}',
  osint_basis               TEXT[],
  simulated_conversion_rate NUMERIC(4,3),
  simulated_response        JSONB,
  embedding_vector          TEXT,
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url                TEXT        NOT NULL DEFAULT 'internal://persona-simulator'
);

CREATE TABLE IF NOT EXISTS meta_configurations (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             UUID    NOT NULL REFERENCES businesses(id) UNIQUE,
  sector                  TEXT    NOT NULL,
  auto_detected_kpis      JSONB   NOT NULL DEFAULT '{}',
  signal_keywords         TEXT[]  NOT NULL DEFAULT '{}',
  trend_thresholds        JSONB   NOT NULL DEFAULT '{}',
  competitor_search_terms TEXT[]  DEFAULT '{}',
  local_radius_meters     INT     DEFAULT 500,
  configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  configuration_version   INT     DEFAULT 1
);

CREATE TABLE IF NOT EXISTS business_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        NOT NULL REFERENCES businesses(id),
  event_type    TEXT        NOT NULL,
  event_data    JSONB       NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT        DEFAULT 'system'
);

-- ── Learning Engine tables ────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_outputs (
  id              TEXT        PRIMARY KEY,
  created_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business TEXT,
  agent_name      TEXT,
  module          TEXT,
  output_type     TEXT,
  content         TEXT,
  context_used    TEXT,
  confidence      NUMERIC(4,3),
  feedback_score  NUMERIC(4,3) DEFAULT 0,
  outcome_status  TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_biz
  ON ai_outputs(linked_business, created_date DESC);

CREATE TABLE IF NOT EXISTS feedback_events (
  id              TEXT        PRIMARY KEY,
  created_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business TEXT,
  ai_output_id    TEXT,
  agent_name      TEXT,
  module          TEXT,
  output_type     TEXT,
  rating          TEXT,
  score           INT,
  comment         TEXT,
  tags            TEXT,
  correction      TEXT,
  action_taken    TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_biz
  ON feedback_events(linked_business, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_agent
  ON feedback_events(linked_business, agent_name);

CREATE TABLE IF NOT EXISTS business_memory (
  id                 TEXT        PRIMARY KEY,
  created_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business    TEXT        UNIQUE,
  preferred_tone     TEXT,
  preferred_channels TEXT,
  rejected_patterns  TEXT,
  accepted_patterns  TEXT,
  lead_preferences   TEXT,
  content_style      TEXT,
  agent_weights      TEXT,
  feedback_summary   TEXT,
  last_updated       TEXT,
  learning_version   INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agent_learning_profiles (
  id                 TEXT        PRIMARY KEY,
  created_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business    TEXT,
  agent_name         TEXT        NOT NULL,
  total_outputs      INT         DEFAULT 0,
  positive_count     INT         DEFAULT 0,
  negative_count     INT         DEFAULT 0,
  accuracy_score     NUMERIC(4,3) DEFAULT 0.5,
  preference_weights TEXT,
  rejected_types     TEXT,
  accepted_types     TEXT,
  last_updated       TEXT,
  UNIQUE(linked_business, agent_name)
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id               TEXT        PRIMARY KEY,
  created_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business  TEXT,
  signal_type      TEXT,
  agent_name       TEXT,
  pattern_key      TEXT,
  pattern_label    TEXT,
  weight           NUMERIC(5,3),
  occurrence_count INT         DEFAULT 1,
  last_seen        TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_signals_biz
  ON learning_signals(linked_business, occurrence_count DESC);

-- ── OTX Engine v2 — Pipeline tables ──────────────────────────

CREATE TABLE IF NOT EXISTS otx_fused_insights (
  id                  TEXT        PRIMARY KEY,
  business_id         TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  urgency             TEXT        NOT NULL,
  confidence          NUMERIC(4,3) NOT NULL,
  summary             TEXT        NOT NULL,
  key_signals         JSONB       NOT NULL DEFAULT '[]',
  recommended_actions JSONB       NOT NULL DEFAULT '[]',
  predicted_impact    TEXT,
  trace_id            TEXT
);

CREATE INDEX IF NOT EXISTS idx_otx_insights_biz
  ON otx_fused_insights(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otx_decisions (
  id                       TEXT        PRIMARY KEY,
  business_id              TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_type              TEXT        NOT NULL,
  urgency                  TEXT        NOT NULL,
  rationale                TEXT        NOT NULL,
  final_score              NUMERIC(5,3) NOT NULL,
  roi_score                NUMERIC(5,3),
  confidence_score         NUMERIC(5,3),
  business_fit_score       NUMERIC(5,3),
  timing_fit_score         NUMERIC(5,3),
  historical_success_score NUMERIC(5,3),
  execution_mode           TEXT        NOT NULL DEFAULT 'suggest',
  status                   TEXT        NOT NULL DEFAULT 'pending',
  insight_id               TEXT,
  trace_id                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_otx_decisions_biz
  ON otx_decisions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otx_decisions_status
  ON otx_decisions(business_id, status);

CREATE TABLE IF NOT EXISTS otx_recommendations (
  id               TEXT        PRIMARY KEY,
  decision_id      TEXT        NOT NULL,
  business_id      TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  title            TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  cta              TEXT,
  channel          TEXT        NOT NULL,
  urgency          TEXT        NOT NULL,
  action_steps     JSONB       NOT NULL DEFAULT '[]',
  estimated_impact TEXT,
  draft_content    TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_otx_recs_decision
  ON otx_recommendations(decision_id);
CREATE INDEX IF NOT EXISTS idx_otx_recs_biz
  ON otx_recommendations(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otx_execution_tasks (
  id            TEXT        PRIMARY KEY,
  decision_id   TEXT        NOT NULL,
  business_id   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  task_type     TEXT        NOT NULL,
  channel       TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending',
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 3,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_otx_tasks_biz
  ON otx_execution_tasks(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otx_tasks_decision
  ON otx_execution_tasks(decision_id);

CREATE TABLE IF NOT EXISTS otx_sent_actions (
  id          TEXT        PRIMARY KEY,
  task_id     TEXT        NOT NULL,
  business_id TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel     TEXT        NOT NULL,
  result      TEXT,
  success     BOOLEAN     NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_otx_sent_id
  ON otx_sent_actions(id);
CREATE INDEX IF NOT EXISTS idx_otx_sent_biz
  ON otx_sent_actions(business_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS otx_outcome_events (
  id            TEXT        PRIMARY KEY,
  decision_id   TEXT        NOT NULL,
  business_id   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_name    TEXT        NOT NULL,
  result        TEXT        NOT NULL CHECK (result IN ('success','failure','partial')),
  revenue_impact NUMERIC(12,2),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_otx_outcomes_biz
  ON otx_outcome_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otx_outcomes_agent
  ON otx_outcome_events(business_id, agent_name);

CREATE TABLE IF NOT EXISTS otx_policy_weights (
  id             TEXT        PRIMARY KEY,
  business_id    TEXT        NOT NULL,
  agent_name     TEXT        NOT NULL,
  action_type    TEXT        NOT NULL,
  weight         NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  success_rate   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  sample_size    INT          NOT NULL DEFAULT 0,
  last_updated   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  policy_version INT          NOT NULL DEFAULT 1,
  UNIQUE(business_id, agent_name, action_type)
);

CREATE INDEX IF NOT EXISTS idx_otx_weights_biz
  ON otx_policy_weights(business_id, agent_name);

CREATE TABLE IF NOT EXISTS otx_pipeline_runs (
  run_id             TEXT        PRIMARY KEY,
  business_id        TEXT        NOT NULL,
  trace_id           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  mode               TEXT        NOT NULL DEFAULT 'full',
  triggered_by       TEXT        NOT NULL DEFAULT 'manual',
  status             TEXT        NOT NULL DEFAULT 'completed',
  signals_processed  INT         NOT NULL DEFAULT 0,
  insights_created   INT         NOT NULL DEFAULT 0,
  decisions_created  INT         NOT NULL DEFAULT 0,
  actions_dispatched INT         NOT NULL DEFAULT 0,
  duration_ms        INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otx_runs_biz
  ON otx_pipeline_runs(business_id, created_at DESC);

-- ── OTX Engine v3 — New tables ────────────────────────────────

-- Opportunities (detected from signals + forecasts + events)
CREATE TABLE IF NOT EXISTS otx_opportunities (
  id                    TEXT        PRIMARY KEY,
  business_id           TEXT        NOT NULL,
  type                  TEXT        NOT NULL,
  source_signal_ids     JSONB       NOT NULL DEFAULT '[]',
  source_event_ids      JSONB       NOT NULL DEFAULT '[]',
  source_forecast_ids   JSONB       NOT NULL DEFAULT '[]',
  opportunity_score     NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  urgency               TEXT        NOT NULL DEFAULT 'medium',
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  expected_window_start TIMESTAMPTZ,
  expected_window_end   TIMESTAMPTZ,
  explanation           TEXT        NOT NULL DEFAULT '',
  dedup_key             TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_otx_opps_biz_status
  ON otx_opportunities(business_id, status, created_at DESC);

-- Threats (detected from signals + reviews + competitor data)
CREATE TABLE IF NOT EXISTS otx_threats (
  id           TEXT        PRIMARY KEY,
  business_id  TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  risk_score   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  urgency      TEXT        NOT NULL DEFAULT 'medium',
  confidence   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  explanation  TEXT        NOT NULL DEFAULT '',
  signal_ids   JSONB       NOT NULL DEFAULT '[]',
  dedup_key    TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_otx_threats_biz_status
  ON otx_threats(business_id, status, created_at DESC);

-- Weight update log — explainable audit trail for every weight change
CREATE TABLE IF NOT EXISTS otx_weight_update_log (
  id           TEXT        PRIMARY KEY,
  business_id  TEXT        NOT NULL,
  agent_name   TEXT        NOT NULL,
  action_type  TEXT        NOT NULL,
  old_weight   NUMERIC(5,4) NOT NULL,
  new_weight   NUMERIC(5,4) NOT NULL,
  trigger_type TEXT        NOT NULL,  -- 'feedback' | 'outcome' | 'cycle'
  trigger_id   TEXT,
  delta        NUMERIC(6,4) NOT NULL,
  reason       TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_otx_wlog_biz_agent
  ON otx_weight_update_log(business_id, agent_name, created_at DESC);

-- ── ALTER existing tables for v3 columns ─────────────────────

-- Add traceability columns to otx_recommendations
ALTER TABLE otx_recommendations
  ADD COLUMN IF NOT EXISTS insight_id        TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_ids   JSONB    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS signal_ids        JSONB    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS trace_id          TEXT,
  ADD COLUMN IF NOT EXISTS summary           TEXT,
  ADD COLUMN IF NOT EXISTS why_now           TEXT,
  ADD COLUMN IF NOT EXISTS recommended_steps JSONB    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS recommended_timing TEXT,
  ADD COLUMN IF NOT EXISTS user_visible_payload JSONB DEFAULT '{}';

-- Add policy + state columns to otx_decisions
ALTER TABLE otx_decisions
  ADD COLUMN IF NOT EXISTS fused_insight_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_version   INT       DEFAULT 1,
  ADD COLUMN IF NOT EXISTS score_breakdown  JSONB     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS context_snapshot JSONB     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags             TEXT[];

-- Add recommendation_id and approval columns to otx_execution_tasks
ALTER TABLE otx_execution_tasks
  ADD COLUMN IF NOT EXISTS recommendation_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_for     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_payload    JSONB    DEFAULT '{}';

-- Add conversion_flag and enriched fields to otx_outcome_events
ALTER TABLE otx_outcome_events
  ADD COLUMN IF NOT EXISTS execution_task_id TEXT,
  ADD COLUMN IF NOT EXISTS outcome_type      TEXT     DEFAULT 'execution',
  ADD COLUMN IF NOT EXISTS outcome_score     NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS conversion_flag   BOOLEAN  DEFAULT false;

-- Add channel/timing prefs to business_memory
ALTER TABLE business_memory
  ADD COLUMN IF NOT EXISTS channel_preferences TEXT,
  ADD COLUMN IF NOT EXISTS timing_preferences  TEXT;

-- Add opportunities_found / threats_found counters to pipeline runs
ALTER TABLE otx_pipeline_runs
  ADD COLUMN IF NOT EXISTS opportunities_found INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threats_found       INT DEFAULT 0;
