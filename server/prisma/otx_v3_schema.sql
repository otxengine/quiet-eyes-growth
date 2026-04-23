-- ============================================================
-- OTX Engine v3 — Relational Schema (PostgreSQL / Supabase)
-- UUID primary keys, timestamptz, full FK chain, dedup indexes.
-- Safe to run after otx_tables.sql — all use IF NOT EXISTS.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ============================================================
-- CORE RELATIONAL CHAIN
--
-- signals_raw
--   → classified_signals
--   → opportunities / threats
--   → business_context_snapshots
--   → fused_insights
--   → decisions
--   → recommendations
--   → execution_tasks
--   → sent_actions
--   → feedback_events / behavior_events / outcome_events
--   → business_memory / agent_learning_profiles / weight_update_logs
-- ============================================================

-- ── 1. Raw signals ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_signals_raw (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('web','social','review','market','osint','competitor')),
  business_scope  TEXT        NOT NULL,
  sector          TEXT        NOT NULL DEFAULT 'general',
  location        TEXT,
  normalized_text TEXT        NOT NULL,
  raw_payload     JSONB       NOT NULL DEFAULT '{}',
  hash            TEXT        NOT NULL,                    -- sha256 dedup
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_signals_hash
  ON v3_signals_raw(hash);
CREATE INDEX IF NOT EXISTS idx_v3_signals_biz_time
  ON v3_signals_raw(business_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_signals_source
  ON v3_signals_raw(source, collected_at DESC);

-- ── 2. Classified signals ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_classified_signals (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID        NOT NULL,   -- references v3_signals_raw(id)
  business_id         TEXT        NOT NULL,
  intent_score        NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (intent_score BETWEEN 0 AND 1),
  sector_match        NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (sector_match BETWEEN 0 AND 1),
  location_relevance  NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (location_relevance BETWEEN 0 AND 1),
  urgency_score       NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (urgency_score BETWEEN 0 AND 1),
  novelty_score       NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (novelty_score BETWEEN 0 AND 1),
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  composite_score     NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (composite_score BETWEEN 0 AND 1),
  classified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_classified_biz
  ON v3_classified_signals(business_id, classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_classified_signal
  ON v3_classified_signals(signal_id);
CREATE INDEX IF NOT EXISTS idx_v3_classified_composite
  ON v3_classified_signals(business_id, composite_score DESC);

-- ── 3. Opportunities ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_opportunities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           TEXT        NOT NULL,
  type                  TEXT        NOT NULL,
  source_signal_ids     UUID[]      NOT NULL DEFAULT '{}',
  source_event_ids      UUID[]      NOT NULL DEFAULT '{}',
  source_forecast_ids   UUID[]      NOT NULL DEFAULT '{}',
  opportunity_score     NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (opportunity_score BETWEEN 0 AND 1),
  urgency               TEXT        NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  expected_window_start TIMESTAMPTZ,
  expected_window_end   TIMESTAMPTZ,
  explanation           TEXT        NOT NULL DEFAULT '',
  dedup_key             TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','acted_on','expired','dismissed','merged','monitoring','resolved')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_opps_dedup
  ON v3_opportunities(business_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_v3_opps_biz_status
  ON v3_opportunities(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_opps_urgency
  ON v3_opportunities(business_id, urgency) WHERE status = 'active';

-- ── 4. Threats ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_threats (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  risk_score  NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (risk_score BETWEEN 0 AND 1),
  urgency     TEXT        NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
  confidence  NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  explanation TEXT        NOT NULL DEFAULT '',
  signal_ids  UUID[]      NOT NULL DEFAULT '{}',
  dedup_key   TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','mitigated','expired','monitoring','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_threats_dedup
  ON v3_threats(business_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_v3_threats_biz_status
  ON v3_threats(business_id, status, created_at DESC);

-- ── 5. Business context snapshots ────────────────────────────

CREATE TABLE IF NOT EXISTS v3_context_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     TEXT        NOT NULL,
  trace_id        TEXT        NOT NULL,
  snapshot        JSONB       NOT NULL DEFAULT '{}',  -- serialized EnrichedContext
  signals_total   INT         NOT NULL DEFAULT 0,
  health_score    NUMERIC(5,2),
  hot_leads       INT         NOT NULL DEFAULT 0,
  opportunities   INT         NOT NULL DEFAULT 0,
  threats         INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_snapshots_biz
  ON v3_context_snapshots(business_id, created_at DESC);

-- ── 6. Fused insights ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_fused_insights (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              TEXT        NOT NULL,
  context_snapshot_id      UUID        REFERENCES v3_context_snapshots(id),
  trace_id                 TEXT        NOT NULL,
  primary_type             TEXT        NOT NULL CHECK (primary_type IN ('opportunity','threat','mixed')),
  top_summary              TEXT        NOT NULL DEFAULT '',
  top_opportunity          TEXT        NOT NULL DEFAULT '',
  urgency                  TEXT        NOT NULL CHECK (urgency IN ('low','medium','high','critical')),
  confidence               NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  expected_business_impact TEXT,
  explanation              TEXT,
  contributing_items       JSONB       NOT NULL DEFAULT '[]',
  contributing_signals     TEXT[]      NOT NULL DEFAULT '{}',
  suggested_action_types   TEXT[]      NOT NULL DEFAULT '{}',
  raw_signals_count        INT         NOT NULL DEFAULT 0,
  policy_version           TEXT        NOT NULL DEFAULT '1.0.0',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_insights_biz
  ON v3_fused_insights(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_insights_urgency
  ON v3_fused_insights(business_id, urgency, created_at DESC);

-- ── 7. Decisions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_decisions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         TEXT        NOT NULL,
  fused_insight_id    UUID        NOT NULL REFERENCES v3_fused_insights(id),
  trace_id            TEXT        NOT NULL,
  chosen_action_type  TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  decision_reasoning  TEXT        NOT NULL DEFAULT '',
  priority            NUMERIC(5,2) NOT NULL DEFAULT 50,
  score               NUMERIC(5,2) NOT NULL DEFAULT 0,
  score_breakdown     JSONB       NOT NULL DEFAULT '{}',
  expected_roi        NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  execution_mode      TEXT        NOT NULL DEFAULT 'suggest'
                        CHECK (execution_mode IN ('suggest','draft','approval','auto')),
  approval_required   BOOLEAN     NOT NULL DEFAULT TRUE,
  policy_version      TEXT        NOT NULL DEFAULT '1.0.0',
  status              TEXT        NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','approved','rejected','executing','executed','measured','learned')),
  tags                TEXT[]      DEFAULT '{}',
  context_snapshot    JSONB       DEFAULT '{}',
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_decisions_biz_time
  ON v3_decisions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_decisions_status
  ON v3_decisions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_v3_decisions_insight
  ON v3_decisions(fused_insight_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_decisions_idempotency
  ON v3_decisions(business_id, fused_insight_id, chosen_action_type, policy_version);

-- ── 8. Recommendations ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_recommendations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id           UUID        NOT NULL REFERENCES v3_decisions(id),
  business_id           TEXT        NOT NULL,
  insight_id            UUID        REFERENCES v3_fused_insights(id),
  trace_id              TEXT,
  opportunity_ids       UUID[]      DEFAULT '{}',
  signal_ids            TEXT[]      DEFAULT '{}',
  title                 TEXT        NOT NULL,
  summary               TEXT        NOT NULL,
  body                  TEXT        NOT NULL DEFAULT '',
  why_now               TEXT,
  cta                   TEXT,
  channel               TEXT        NOT NULL,
  recommended_channel   TEXT        NOT NULL,
  urgency               TEXT        NOT NULL CHECK (urgency IN ('low','medium','high','critical')),
  estimated_impact      TEXT,
  recommended_steps     JSONB       NOT NULL DEFAULT '[]',
  recommended_timing    TIMESTAMPTZ,
  draft_content         TEXT,
  user_visible_payload  JSONB       NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','delivered','accepted','rejected','expired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_recs_decision
  ON v3_recommendations(decision_id);
CREATE INDEX IF NOT EXISTS idx_v3_recs_biz
  ON v3_recommendations(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_recs_insight
  ON v3_recommendations(insight_id);

-- ── 9. Execution tasks ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_execution_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id      UUID        NOT NULL REFERENCES v3_decisions(id),
  recommendation_id UUID       REFERENCES v3_recommendations(id),
  business_id      TEXT        NOT NULL,
  task_type        TEXT        NOT NULL,
  channel          TEXT,
  payload          JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created','queued','prepared','awaiting_approval','approved','dispatched','completed','failed','canceled')),
  approval_required BOOLEAN    NOT NULL DEFAULT TRUE,
  scheduled_for    TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  executed_at      TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  result_payload   JSONB       DEFAULT '{}',
  attempts         INT         NOT NULL DEFAULT 0,
  max_attempts     INT         NOT NULL DEFAULT 3,
  error_message    TEXT,
  idempotency_key  TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_v3_tasks_idempotency
  ON v3_execution_tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_v3_tasks_decision
  ON v3_execution_tasks(decision_id);
CREATE INDEX IF NOT EXISTS idx_v3_tasks_biz
  ON v3_execution_tasks(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_tasks_status
  ON v3_execution_tasks(business_id, status);

-- ── 10. Sent actions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_sent_actions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES v3_execution_tasks(id),
  business_id TEXT        NOT NULL,
  channel     TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  result      TEXT,
  success     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_sent_biz
  ON v3_sent_actions(business_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_sent_task
  ON v3_sent_actions(task_id);

-- ── 11. Feedback events ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_feedback_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       TEXT        NOT NULL,
  user_id           TEXT,
  output_id         TEXT        NOT NULL,          -- decision_id or recommendation_id
  output_type       TEXT        NOT NULL,          -- 'decision' | 'recommendation' | 'action'
  feedback_type     TEXT        NOT NULL           -- 'thumbs_up' | 'thumbs_down' | 'correction' | 'edit' | 'ignore' | 'manual_override'
                      CHECK (feedback_type IN ('thumbs_up','thumbs_down','correction','edit','ignore','manual_override')),
  score             SMALLINT    NOT NULL DEFAULT 0 CHECK (score BETWEEN -1 AND 1),
  comment           TEXT,
  tags              JSONB       DEFAULT '[]',
  correction_payload JSONB      DEFAULT '{}',
  agent_name        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_feedback_biz
  ON v3_feedback_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_feedback_output
  ON v3_feedback_events(output_id);
CREATE INDEX IF NOT EXISTS idx_v3_feedback_type
  ON v3_feedback_events(business_id, feedback_type);

-- ── 12. Outcome events ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_outcome_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       TEXT        NOT NULL,
  decision_id       UUID        REFERENCES v3_decisions(id),
  execution_task_id UUID        REFERENCES v3_execution_tasks(id),
  agent_name        TEXT        NOT NULL,
  outcome_type      TEXT        NOT NULL
                      CHECK (outcome_type IN ('manual_mark','auto_execution','revenue_linked','conversion','rejection')),
  result            TEXT        NOT NULL CHECK (result IN ('success','failure','partial')),
  outcome_score     NUMERIC(4,3) CHECK (outcome_score BETWEEN 0 AND 1),
  revenue_impact    NUMERIC(12,2),
  conversion_flag   BOOLEAN     NOT NULL DEFAULT FALSE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_outcomes_biz
  ON v3_outcome_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_outcomes_decision
  ON v3_outcome_events(decision_id);
CREATE INDEX IF NOT EXISTS idx_v3_outcomes_task
  ON v3_outcome_events(execution_task_id);
CREATE INDEX IF NOT EXISTS idx_v3_outcomes_agent
  ON v3_outcome_events(business_id, agent_name);

-- ── 13. Business memory ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_business_memory (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                 TEXT        NOT NULL UNIQUE,
  preferred_tone              TEXT        NOT NULL DEFAULT 'professional',
  preferred_channels          TEXT[]      NOT NULL DEFAULT '{}',
  rejected_patterns           JSONB       NOT NULL DEFAULT '[]',
  accepted_patterns           JSONB       NOT NULL DEFAULT '[]',
  agent_weights               JSONB       NOT NULL DEFAULT '{}',
  channel_preferences         JSONB       NOT NULL DEFAULT '{}',
  timing_preferences          JSONB       NOT NULL DEFAULT '{}',
  tone_preferences            TEXT[]      NOT NULL DEFAULT '{}',
  sector_specific_preferences JSONB       NOT NULL DEFAULT '{}',
  feedback_summary            JSONB       NOT NULL DEFAULT '{}',
  learning_version            INT         NOT NULL DEFAULT 1,
  last_updated                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_memory_biz
  ON v3_business_memory(business_id);

-- ── 14. Agent learning profiles ──────────────────────────────

CREATE TABLE IF NOT EXISTS v3_agent_learning_profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    TEXT        NOT NULL,
  agent_name     TEXT        NOT NULL,
  total_outputs  INT         NOT NULL DEFAULT 0,
  positive_count INT         NOT NULL DEFAULT 0,
  negative_count INT         NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  rejected_types JSONB       NOT NULL DEFAULT '[]',
  accepted_types JSONB       NOT NULL DEFAULT '[]',
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_v3_profiles_biz
  ON v3_agent_learning_profiles(business_id, accuracy_score DESC);

-- ── 15. Policy weights ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_policy_weights (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    TEXT        NOT NULL,
  agent_name     TEXT        NOT NULL,
  action_type    TEXT        NOT NULL,
  weight         NUMERIC(4,3) NOT NULL DEFAULT 0.5
                   CHECK (weight BETWEEN 0.10 AND 0.90),
  success_rate   NUMERIC(4,3) NOT NULL DEFAULT 0.5
                   CHECK (success_rate BETWEEN 0 AND 1),
  sample_size    INT         NOT NULL DEFAULT 0,
  policy_version TEXT        NOT NULL DEFAULT '1.0.0',
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, agent_name, action_type)
);

CREATE INDEX IF NOT EXISTS idx_v3_weights_biz
  ON v3_policy_weights(business_id, agent_name);

-- ── 16. Weight update log (explainability audit) ──────────────

CREATE TABLE IF NOT EXISTS v3_weight_update_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    TEXT        NOT NULL,
  agent_name     TEXT        NOT NULL,
  action_type    TEXT        NOT NULL,
  entity_type    TEXT        NOT NULL DEFAULT 'policy_weight',
  entity_id      UUID,
  old_weight     NUMERIC(6,4) NOT NULL,
  new_weight     NUMERIC(6,4) NOT NULL,
  delta          NUMERIC(6,4) NOT NULL,
  trigger_type   TEXT        NOT NULL CHECK (trigger_type IN ('feedback','outcome','cycle')),
  trigger_id     TEXT,
  update_reason  TEXT        NOT NULL,
  policy_version TEXT        NOT NULL DEFAULT '1.0.0',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_wlog_biz_agent
  ON v3_weight_update_log(business_id, agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_wlog_trigger
  ON v3_weight_update_log(trigger_type, created_at DESC);

-- ── 17. Pipeline runs ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_pipeline_runs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          TEXT        NOT NULL,
  trace_id             TEXT        NOT NULL,
  mode                 TEXT        NOT NULL DEFAULT 'full'
                         CHECK (mode IN ('full','partial','signal_only','decision_only')),
  triggered_by         TEXT        NOT NULL DEFAULT 'manual'
                         CHECK (triggered_by IN ('schedule','manual','event','webhook')),
  status               TEXT        NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','failed','skipped')),
  signals_processed    INT         NOT NULL DEFAULT 0,
  opportunities_found  INT         NOT NULL DEFAULT 0,
  threats_found        INT         NOT NULL DEFAULT 0,
  insights_created     INT         NOT NULL DEFAULT 0,
  decisions_created    INT         NOT NULL DEFAULT 0,
  actions_dispatched   INT         NOT NULL DEFAULT 0,
  duration_ms          INT         NOT NULL DEFAULT 0,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_runs_biz
  ON v3_pipeline_runs(business_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_runs_status
  ON v3_pipeline_runs(status, started_at DESC);

-- ============================================================
-- ITERATION 3 ADDITIONS
-- Audit logs, approval requests, explainability tables
-- ============================================================

-- ── Audit logs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_audit_logs (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL,
  tenant_id     TEXT,
  actor_type    TEXT        NOT NULL CHECK (actor_type IN ('system','user','agent')),
  actor_id      TEXT        NOT NULL,
  entity_type   TEXT        NOT NULL,
  entity_id     TEXT        NOT NULL,
  action        TEXT        NOT NULL,
  old_state     TEXT,
  new_state     TEXT,
  reason        TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_audit_biz_entity
  ON v3_audit_logs(business_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_audit_action
  ON v3_audit_logs(action, created_at DESC);

-- ── Approval requests ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_approval_requests (
  id                TEXT        PRIMARY KEY,
  business_id       TEXT        NOT NULL,
  tenant_id         TEXT,
  decision_id       TEXT        NOT NULL REFERENCES v3_decisions(id) ON DELETE CASCADE,
  recommendation_id TEXT        REFERENCES v3_recommendations(id) ON DELETE SET NULL,
  execution_task_id TEXT        REFERENCES v3_execution_tasks(id) ON DELETE SET NULL,
  approval_type     TEXT        NOT NULL CHECK (approval_type IN ('execution','recommendation','override')),
  requested_by      TEXT        NOT NULL,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
  resolved_by       TEXT,
  resolved_at       TIMESTAMPTZ,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_v3_approval_biz_status
  ON v3_approval_requests(business_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_approval_decision
  ON v3_approval_requests(decision_id);

-- ── Insight explanations ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_insight_explanations (
  id                    TEXT        PRIMARY KEY,
  fused_insight_id      TEXT        NOT NULL REFERENCES v3_fused_insights(id) ON DELETE CASCADE,
  business_id           TEXT        NOT NULL,
  contributing_signals  JSONB       NOT NULL DEFAULT '[]',
  contributing_events   JSONB       NOT NULL DEFAULT '[]',
  contributing_forecasts JSONB      NOT NULL DEFAULT '[]',
  top_factors           JSONB       NOT NULL DEFAULT '[]',
  reasoning_summary     TEXT        NOT NULL,
  confidence_breakdown  JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_insight_expl_insight
  ON v3_insight_explanations(fused_insight_id);

-- ── Decision explanations ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_decision_explanations (
  id                    TEXT        PRIMARY KEY,
  decision_id           TEXT        NOT NULL REFERENCES v3_decisions(id) ON DELETE CASCADE,
  business_id           TEXT        NOT NULL,
  chosen_action_type    TEXT        NOT NULL,
  rejected_action_types JSONB       NOT NULL DEFAULT '[]',
  score_breakdown       JSONB       NOT NULL DEFAULT '{}',
  policy_checks_passed  JSONB       NOT NULL DEFAULT '[]',
  policy_checks_failed  JSONB       NOT NULL DEFAULT '[]',
  reasoning_summary     TEXT        NOT NULL,
  memory_factors_used   JSONB       NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_decision_expl_decision
  ON v3_decision_explanations(decision_id);

-- ── Recommendation explanations ───────────────────────────────

CREATE TABLE IF NOT EXISTS v3_recommendation_explanations (
  id                        TEXT        PRIMARY KEY,
  recommendation_id         TEXT        NOT NULL REFERENCES v3_recommendations(id) ON DELETE CASCADE,
  business_id               TEXT        NOT NULL,
  why_now                   TEXT        NOT NULL,
  why_this_channel          TEXT        NOT NULL,
  why_this_timing           TEXT        NOT NULL,
  expected_impact_reasoning TEXT        NOT NULL,
  supporting_patterns       JSONB       NOT NULL DEFAULT '[]',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_rec_expl_rec
  ON v3_recommendation_explanations(recommendation_id);

-- ── Learning explanations ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3_learning_explanations (
  id                       TEXT        PRIMARY KEY,
  business_id              TEXT        NOT NULL,
  update_source_type       TEXT        NOT NULL
                             CHECK (update_source_type IN ('feedback','outcome','override','cycle')),
  update_source_id         TEXT        NOT NULL,
  updated_weights          JSONB       NOT NULL DEFAULT '[]',
  updated_preferences      JSONB       NOT NULL DEFAULT '[]',
  rejected_patterns_added  JSONB       NOT NULL DEFAULT '[]',
  confidence_changes       JSONB       NOT NULL DEFAULT '[]',
  reasoning_summary        TEXT        NOT NULL,
  significance             TEXT        NOT NULL CHECK (significance IN ('low','medium','high')),
  is_short_term            BOOLEAN     NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_learning_expl_biz
  ON v3_learning_explanations(business_id, created_at DESC);
