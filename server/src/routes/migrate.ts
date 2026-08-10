/**
 * One-time migration runner — POST /api/migrate
 * Runs raw SQL via Prisma.$executeRawUnsafe in sequence.
 * Protected by a secret header to prevent accidental exposure.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';

const router = Router();
// No default secret — must be explicitly set in env or use admin key
const MIGRATION_SECRET = process.env.MIGRATION_SECRET;

router.post('/', async (req: Request, res: Response) => {
  const { isAdminKeyRequest } = require('../middleware/auth');
  const validMigrationSecret = !!MIGRATION_SECRET && req.headers['x-migration-secret'] === MIGRATION_SECRET;
  const validAdminKey = isAdminKeyRequest(req);
  if (!validMigrationSecret && !validAdminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const results: string[] = [];
  const errors: string[] = [];

  const statements = [
    // pgvector extension (may already exist — safe to run)
    `CREATE EXTENSION IF NOT EXISTS vector`,

    // hyper_local_events
    `CREATE TABLE IF NOT EXISTS hyper_local_events (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id          TEXT        NOT NULL REFERENCES business_profiles(id),
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
    )`,

    `CREATE INDEX IF NOT EXISTS idx_hyperlocal_biz_date ON hyper_local_events(business_id, event_datetime)`,

    // demand_forecasts
    `CREATE TABLE IF NOT EXISTS demand_forecasts (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id           TEXT        NOT NULL REFERENCES business_profiles(id),
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
    )`,

    `CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_biz_date_hour ON demand_forecasts(business_id, forecast_date, COALESCE(hour_of_day, -1))`,

    // resource_arbitrage_actions
    `CREATE TABLE IF NOT EXISTS resource_arbitrage_actions (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id          TEXT        NOT NULL REFERENCES business_profiles(id),
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
    )`,

    // cross_sector_signals
    `CREATE TABLE IF NOT EXISTS cross_sector_signals (
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
    )`,

    `CREATE INDEX IF NOT EXISTS idx_cross_sector ON cross_sector_signals(source_sector, target_sector, detected_at_utc DESC)`,

    // synthetic_personas (without pgvector column — use TEXT for embedding to avoid extension dependency)
    `CREATE TABLE IF NOT EXISTS synthetic_personas (
      id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id               TEXT        NOT NULL REFERENCES business_profiles(id),
      persona_name              TEXT        NOT NULL,
      demographic_profile       JSONB       NOT NULL DEFAULT '{}',
      behavioral_traits         JSONB       NOT NULL DEFAULT '{}',
      osint_basis               TEXT[],
      simulated_conversion_rate NUMERIC(4,3),
      simulated_response        JSONB,
      embedding_vector          TEXT,
      computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_url                TEXT        NOT NULL DEFAULT 'internal://persona-simulator'
    )`,

    // meta_configurations (no FK — uses TEXT business_id for compatibility)
    `CREATE TABLE IF NOT EXISTS meta_configurations (
      id                      TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
      business_id             TEXT    NOT NULL UNIQUE,
      sector                  TEXT    NOT NULL DEFAULT '',
      auto_detected_kpis      JSONB   NOT NULL DEFAULT '{}',
      signal_keywords         TEXT[]  NOT NULL DEFAULT '{}',
      trend_thresholds        JSONB   NOT NULL DEFAULT '{}',
      competitor_search_terms TEXT[]  DEFAULT '{}',
      local_radius_meters     INT     DEFAULT 500,
      configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      configuration_version   INT     DEFAULT 1
    )`,

    // business_events (used by EventImpactEngine)
    `CREATE TABLE IF NOT EXISTS business_events (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id   TEXT        NOT NULL REFERENCES business_profiles(id),
      event_type    TEXT        NOT NULL,
      event_data    JSONB       NOT NULL DEFAULT '{}',
      occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      source        TEXT        DEFAULT 'system'
    )`,

    // ── Learning Engine tables ────────────────────────────────────────────────

    `CREATE TABLE IF NOT EXISTS ai_outputs (
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
    )`,

    `CREATE INDEX IF NOT EXISTS idx_ai_outputs_biz ON ai_outputs(linked_business, created_date DESC)`,

    `CREATE TABLE IF NOT EXISTS feedback_events (
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
    )`,

    `CREATE INDEX IF NOT EXISTS idx_feedback_biz ON feedback_events(linked_business, created_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_events(linked_business, agent_name)`,

    `CREATE TABLE IF NOT EXISTS business_memory (
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
    )`,

    `CREATE TABLE IF NOT EXISTS agent_learning_profiles (
      id                 TEXT        PRIMARY KEY,
      created_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
      linked_business    TEXT,
      agent_name         TEXT        NOT NULL,
      total_outputs      INT DEFAULT 0,
      positive_count     INT DEFAULT 0,
      negative_count     INT DEFAULT 0,
      accuracy_score     NUMERIC(4,3) DEFAULT 0.5,
      preference_weights TEXT,
      rejected_types     TEXT,
      accepted_types     TEXT,
      last_updated       TEXT,
      UNIQUE(linked_business, agent_name)
    )`,

    `CREATE TABLE IF NOT EXISTS learning_signals (
      id               TEXT        PRIMARY KEY,
      created_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
      linked_business  TEXT,
      signal_type      TEXT,
      agent_name       TEXT,
      pattern_key      TEXT,
      pattern_label    TEXT,
      weight           NUMERIC(5,3),
      occurrence_count INT DEFAULT 1,
      last_seen        TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_learning_signals_biz ON learning_signals(linked_business, occurrence_count DESC)`,

    // ── OTX Engine v2 tables ──────────────────────────────────────────────────

    `CREATE TABLE IF NOT EXISTS otx_fused_insights (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      urgency         TEXT        NOT NULL,
      confidence      NUMERIC(4,3) NOT NULL,
      summary         TEXT        NOT NULL,
      key_signals     JSONB       NOT NULL DEFAULT '[]',
      recommended_actions JSONB   NOT NULL DEFAULT '[]',
      predicted_impact TEXT,
      trace_id        TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_insights_biz ON otx_fused_insights(business_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS otx_decisions (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      action_type     TEXT        NOT NULL,
      urgency         TEXT        NOT NULL,
      rationale       TEXT        NOT NULL,
      final_score     NUMERIC(5,3) NOT NULL,
      roi_score       NUMERIC(5,3),
      confidence_score NUMERIC(5,3),
      business_fit_score NUMERIC(5,3),
      timing_fit_score NUMERIC(5,3),
      historical_success_score NUMERIC(5,3),
      execution_mode  TEXT        NOT NULL DEFAULT 'suggest',
      status          TEXT        NOT NULL DEFAULT 'pending',
      insight_id      TEXT,
      trace_id        TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_decisions_biz ON otx_decisions(business_id, created_at DESC)`,

    // Backfill columns added after initial table creation
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS insight_id TEXT`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS trace_id TEXT`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS roi_score NUMERIC(5,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS business_fit_score NUMERIC(5,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS timing_fit_score NUMERIC(5,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS historical_success_score NUMERIC(5,3)`,

    `CREATE INDEX IF NOT EXISTS idx_otx_decisions_status ON otx_decisions(business_id, status)`,

    `CREATE TABLE IF NOT EXISTS otx_recommendations (
      id              TEXT        PRIMARY KEY,
      decision_id     TEXT        NOT NULL,
      business_id     TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      title           TEXT        NOT NULL,
      body            TEXT        NOT NULL,
      cta             TEXT,
      channel         TEXT        NOT NULL,
      urgency         TEXT        NOT NULL,
      action_steps    JSONB       NOT NULL DEFAULT '[]',
      estimated_impact TEXT,
      draft_content   TEXT,
      status          TEXT        NOT NULL DEFAULT 'pending'
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_recs_decision ON otx_recommendations(decision_id)`,
    `CREATE INDEX IF NOT EXISTS idx_otx_recs_biz ON otx_recommendations(business_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS otx_execution_tasks (
      id              TEXT        PRIMARY KEY,
      decision_id     TEXT        NOT NULL,
      business_id     TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      task_type       TEXT        NOT NULL,
      channel         TEXT        NOT NULL,
      payload         JSONB       NOT NULL DEFAULT '{}',
      status          TEXT        NOT NULL DEFAULT 'pending',
      attempts        INT         NOT NULL DEFAULT 0,
      max_attempts    INT         NOT NULL DEFAULT 3,
      error_message   TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_tasks_biz ON otx_execution_tasks(business_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_otx_tasks_decision ON otx_execution_tasks(decision_id)`,

    `CREATE TABLE IF NOT EXISTS otx_sent_actions (
      id              TEXT        PRIMARY KEY,
      task_id         TEXT        NOT NULL,
      business_id     TEXT        NOT NULL,
      sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      channel         TEXT        NOT NULL,
      result          TEXT,
      success         BOOLEAN     NOT NULL DEFAULT true
    )`,

    `CREATE UNIQUE INDEX IF NOT EXISTS idx_otx_sent_id ON otx_sent_actions(id)`,
    `CREATE INDEX IF NOT EXISTS idx_otx_sent_biz ON otx_sent_actions(business_id, sent_at DESC)`,

    `CREATE TABLE IF NOT EXISTS otx_outcome_events (
      id              TEXT        PRIMARY KEY,
      decision_id     TEXT        NOT NULL,
      business_id     TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      agent_name      TEXT        NOT NULL,
      result          TEXT        NOT NULL CHECK (result IN ('success','failure','partial')),
      revenue_impact  NUMERIC(12,2),
      notes           TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_outcomes_biz ON otx_outcome_events(business_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_otx_outcomes_agent ON otx_outcome_events(business_id, agent_name)`,

    `CREATE TABLE IF NOT EXISTS otx_policy_weights (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      agent_name      TEXT        NOT NULL,
      action_type     TEXT        NOT NULL,
      weight          NUMERIC(4,3) NOT NULL DEFAULT 0.5,
      success_rate    NUMERIC(4,3) NOT NULL DEFAULT 0.5,
      sample_size     INT         NOT NULL DEFAULT 0,
      last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
      policy_version  INT         NOT NULL DEFAULT 1,
      UNIQUE(business_id, agent_name, action_type)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_weights_biz ON otx_policy_weights(business_id, agent_name)`,

    `CREATE TABLE IF NOT EXISTS otx_pipeline_runs (
      run_id          TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      trace_id        TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      mode            TEXT        NOT NULL DEFAULT 'full',
      triggered_by    TEXT        NOT NULL DEFAULT 'manual',
      status          TEXT        NOT NULL DEFAULT 'completed',
      signals_processed  INT      NOT NULL DEFAULT 0,
      insights_created   INT      NOT NULL DEFAULT 0,
      decisions_created  INT      NOT NULL DEFAULT 0,
      actions_dispatched INT      NOT NULL DEFAULT 0,
      duration_ms     INT         NOT NULL DEFAULT 0
    )`,

    `CREATE INDEX IF NOT EXISTS idx_otx_runs_biz ON otx_pipeline_runs(business_id, created_at DESC)`,

    // ── Backfill columns missing from business_profiles ───────────────────────
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS owner_name TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS phone TEXT`,

    // ── Backfill is_dismissed on market_signals ───────────────────────────────
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN DEFAULT false`,

    // ── Backfill channel/timing preferences on business_memory ───────────────
    `ALTER TABLE business_memory ADD COLUMN IF NOT EXISTS channel_preferences TEXT`,
    `ALTER TABLE business_memory ADD COLUMN IF NOT EXISTS timing_preferences TEXT`,

    // ── Backfill missing columns on otx_decisions (DecisionRepository v3) ────
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS title TEXT`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS reasoning TEXT`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS priority INT DEFAULT 5`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS score NUMERIC(8,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}'`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS expected_roi NUMERIC(8,3)`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS context_snapshot TEXT`,

    // ── v3_approval_requests table ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS v3_approval_requests (
      id                  TEXT        PRIMARY KEY,
      business_id         TEXT        NOT NULL,
      tenant_id           TEXT,
      decision_id         TEXT        NOT NULL,
      recommendation_id   TEXT,
      execution_task_id   TEXT,
      approval_type       TEXT        NOT NULL,
      requested_by        TEXT        NOT NULL,
      requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at          TIMESTAMPTZ,
      status              TEXT        NOT NULL DEFAULT 'pending',
      resolved_by         TEXT,
      resolved_at         TIMESTAMPTZ,
      notes               TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_approval_biz ON v3_approval_requests(business_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_approval_decision ON v3_approval_requests(decision_id)`,

    // ── campaigns: store external platform campaign ID ────────────────────────
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_campaign_id TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_ad_group_id TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_budget_id    TEXT`,

    // ── otx_opportunities (v3) ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS otx_opportunities (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_otx_opps_biz_status ON otx_opportunities(business_id, status, created_at DESC)`,

    // ── otx_threats (v3) ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS otx_threats (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_otx_threats_biz_status ON otx_threats(business_id, status, created_at DESC)`,

    // ── otx_weight_update_log (v3) ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS otx_weight_update_log (
      id           TEXT        PRIMARY KEY,
      business_id  TEXT        NOT NULL,
      agent_name   TEXT        NOT NULL,
      action_type  TEXT        NOT NULL,
      old_weight   NUMERIC(5,4) NOT NULL,
      new_weight   NUMERIC(5,4) NOT NULL,
      trigger_type TEXT        NOT NULL,
      trigger_id   TEXT,
      delta        NUMERIC(6,4) NOT NULL,
      reason       TEXT        NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_otx_wlog_biz_agent ON otx_weight_update_log(business_id, agent_name, created_at DESC)`,

    // ── ALTER TABLE — add missing columns to existing tables ─────────────────
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS insight_id TEXT`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS opportunity_ids JSONB DEFAULT '[]'`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS signal_ids JSONB DEFAULT '[]'`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS trace_id TEXT`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS summary TEXT`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS why_now TEXT`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS recommended_steps JSONB DEFAULT '[]'`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS recommended_timing TEXT`,
    `ALTER TABLE otx_recommendations ADD COLUMN IF NOT EXISTS user_visible_payload JSONB DEFAULT '{}'`,

    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS fused_insight_id TEXT`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false`,
    `ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS policy_version INT DEFAULT 1`,

    `ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS recommendation_id TEXT`,
    `ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false`,
    `ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`,
    `ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ`,
    `ALTER TABLE otx_execution_tasks ADD COLUMN IF NOT EXISTS result_payload JSONB DEFAULT '{}'`,

    `ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS execution_task_id TEXT`,
    `ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS outcome_type TEXT DEFAULT 'execution'`,
    `ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS outcome_score NUMERIC(4,3)`,
    `ALTER TABLE otx_outcome_events ADD COLUMN IF NOT EXISTS conversion_flag BOOLEAN DEFAULT false`,

    `ALTER TABLE otx_pipeline_runs ADD COLUMN IF NOT EXISTS opportunities_found INT DEFAULT 0`,
    `ALTER TABLE otx_pipeline_runs ADD COLUMN IF NOT EXISTS threats_found INT DEFAULT 0`,

    // ── market_insights (v4) ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS market_insights (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      insight_type    TEXT        NOT NULL,
      title           TEXT        NOT NULL,
      description     TEXT        NOT NULL,
      urgency         TEXT        NOT NULL DEFAULT 'medium',
      confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
      data_payload    JSONB       NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_insights_biz ON market_insights(business_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS otx_trust_snapshots (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      trust_score     NUMERIC(5,2) NOT NULL,
      gap_type        TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_trust_snapshots_biz ON otx_trust_snapshots(business_id, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS otx_churn_risk_logs (
      id              TEXT        PRIMARY KEY,
      business_id     TEXT        NOT NULL,
      risk_level      TEXT        NOT NULL,
      risk_score      NUMERIC(4,3) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_churn_risk_biz ON otx_churn_risk_logs(business_id, created_at DESC)`,

    // Onboarding intelligence columns (added 2026-05)
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS business_goal TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS price_tier TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS customer_sources TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS sector_profile TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS agent_missions TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_draft        TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_status       TEXT DEFAULT 'pending'`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_approved     TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_sources      TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_generated_at TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS about_approved_at  TEXT`,

    // ── Integration layer upgrades ────────────────────────────────────────────
    // OAuth state persistence
    `CREATE TABLE IF NOT EXISTS oauth_state_store (
      id          TEXT        NOT NULL PRIMARY KEY,
      business_id TEXT        NOT NULL,
      platform    TEXT        NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state_store(expires_at)`,

    // social_accounts: refresh token + token expiry
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS expires_at    TEXT`,

    // business_profiles: TikTok execution fields
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS tiktok_access_token TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS tiktok_open_id      TEXT`,

    // business_profiles: email notification field
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS notification_email  TEXT`,

    // ── P1: Lead Freshness + ROI tracking columns ─────────────────────────────
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS discovered_at           TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS freshness_score         DOUBLE PRECISION DEFAULT 100`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at         TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_date      TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_count          DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_source         TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_reasoning         TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS suggested_first_message TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value              DOUBLE PRECISION`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS platform_sourced        BOOLEAN DEFAULT false`,

    // ── P1: Review Sentiment Topic Extraction ────────────────────────────────
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS topics          TEXT`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS topic_sentiment TEXT`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS google_review_id TEXT`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_verified     BOOLEAN DEFAULT false`,

    // ── P1: Health Score — Local SEO ─────────────────────────────────────────
    `ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS seo_score               DOUBLE PRECISION`,
    `ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS google_rank_estimate     TEXT`,
    `ALTER TABLE health_scores ADD COLUMN IF NOT EXISTS reviews_needed_for_top3 DOUBLE PRECISION`,

    // ── P1: Review Request Conversion Tracking ───────────────────────────────
    `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'sent'`,
    `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS review_link         TEXT`,
    `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS sent_via            TEXT`,
    `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS converted_review_id TEXT`,
    `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS lead_id             TEXT`,

    // ── P1: Sector Knowledge — Lead Feedback Loop ────────────────────────────
    `ALTER TABLE sector_knowledge ADD COLUMN IF NOT EXISTS winner_lead_dna TEXT`,

    // ── Competitor enrichment columns ────────────────────────────────────────
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS menu_highlights        TEXT`,
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS price_points           TEXT`,
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS current_promotions     TEXT`,
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS opening_hours          TEXT`,
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS recent_reviews_summary TEXT`,

    // ── MarketSignal — agent/source tagging ──────────────────────────────────
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS agent_name  TEXT`,
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS source_type TEXT`,
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS tags        TEXT`,

    // ── business_profiles: geo + lead quality fields ──────────────────────────
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS search_radius_km    INT DEFAULT 15`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS additional_cities   TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branches            TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_intent_signals TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_quality_notes  TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_place_id          TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_place_id_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_rating             DOUBLE PRECISION`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_review_count       DOUBLE PRECISION`,

    // ── business_profiles: API execution tokens ───────────────────────────────
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS autonomy_level             TEXT DEFAULT 'semi_auto'`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id  TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS whatsapp_access_token      TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_access_token        TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS instagram_access_token     TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS instagram_page_id          TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS facebook_page_token        TEXT`,
    `ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS facebook_page_id           TEXT`,

    // ── Social Comments Inbox ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS social_comments (
      id                   TEXT        PRIMARY KEY,
      created_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
      linked_business      TEXT,
      platform             TEXT        NOT NULL,
      platform_comment_id  TEXT        NOT NULL,
      platform_post_id     TEXT,
      post_message         TEXT,
      author_name          TEXT,
      author_id            TEXT,
      comment_text         TEXT        NOT NULL,
      sentiment            TEXT,
      created_time         TIMESTAMPTZ,
      fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      ai_suggested_reply   TEXT,
      reply_sent           BOOLEAN     NOT NULL DEFAULT false,
      reply_text           TEXT,
      reply_sent_at        TIMESTAMPTZ,
      is_dismissed         BOOLEAN     NOT NULL DEFAULT false,
      UNIQUE(platform, platform_comment_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_comments_biz ON social_comments(linked_business, created_time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_social_comments_unanswered ON social_comments(linked_business, reply_sent, is_dismissed)`,
    // ── Trend intelligence tables ──────────────────────────────────────────────

    // Checkpoint memory: prevents duplicate scanning across server restarts
    `CREATE TABLE IF NOT EXISTS trend_scan_checkpoint (
      checkpoint_key    TEXT        PRIMARY KEY,
      last_scan_at      TIMESTAMPTZ,
      scanned_item_ids  TEXT        DEFAULT '[]',
      scanned_urls      TEXT        DEFAULT '[]',
      scan_meta         TEXT        DEFAULT '{}',
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Global cross-platform trend store (populated by all trend agents)
    `CREATE TABLE IF NOT EXISTS platform_trend (
      id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      platform                 TEXT        NOT NULL,
      region                   TEXT        NOT NULL DEFAULT 'IL',
      trend_type               TEXT        NOT NULL,
      trend_name               TEXT        NOT NULL,
      applicable_sectors       TEXT        DEFAULT '[]',
      growth_rate              REAL,
      volume_estimate          REAL,
      stage                    TEXT,
      evidence_urls            TEXT        DEFAULT '[]',
      visual_analysis          TEXT,
      is_us_leading_indicator  BOOLEAN     DEFAULT false,
      us_detected_at           TIMESTAMPTZ,
      first_detected_at        TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at             TIMESTAMPTZ DEFAULT NOW(),
      confidence               REAL        DEFAULT 70,
      linked_business          TEXT,
      source_agent             TEXT,
      created_at               TIMESTAMPTZ DEFAULT NOW()
    )`,

    // market_signals: add visual_trend to supported categories
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS is_us_leading_indicator BOOLEAN DEFAULT false`,
    `ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'IL'`,

    // ── Layer 7 OTX tables (businesses + agent-specific tables) ──────────────

    // businesses — UUID-based mirror of business_profiles for Layer 7 agents
    `CREATE TABLE IF NOT EXISTS businesses (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT        NOT NULL,
      sector     TEXT        NOT NULL DEFAULT 'local',
      geo_city   TEXT        NOT NULL DEFAULT 'תל אביב',
      price_tier TEXT        NOT NULL DEFAULT 'mid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name)`,

    // viral_patterns — ViralCatalyst output
    `CREATE TABLE IF NOT EXISTS viral_patterns (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      pattern_type     TEXT        NOT NULL DEFAULT 'format',
      pattern_value    TEXT        NOT NULL,
      platform         TEXT        NOT NULL DEFAULT 'instagram',
      virality_score   NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      peak_hour        INT         NOT NULL DEFAULT 19,
      script_template  TEXT,
      source_url       TEXT        NOT NULL,
      confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_viral_patterns_biz ON viral_patterns(business_id, created_at DESC)`,

    // influence_integrity_scores — InfluenceIntegrityAuditor output
    `CREATE TABLE IF NOT EXISTS influence_integrity_scores (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      organic_pct      NUMERIC(5,2) NOT NULL DEFAULT 80,
      bot_pct          NUMERIC(5,2) NOT NULL DEFAULT 10,
      coordinated_pct  NUMERIC(5,2) NOT NULL DEFAULT 10,
      verdict          TEXT        NOT NULL DEFAULT 'organic',
      recommendation   TEXT        NOT NULL DEFAULT '',
      source_url       TEXT        NOT NULL,
      confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_influence_biz ON influence_integrity_scores(business_id, created_at DESC)`,

    // visual_osint_signals — DeepContextVisionAgent output
    `CREATE TABLE IF NOT EXISTS visual_osint_signals (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id           UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      media_url             TEXT        NOT NULL,
      platform              TEXT        NOT NULL DEFAULT 'google',
      business_insight      TEXT        NOT NULL DEFAULT '',
      unmet_demand_detected BOOLEAN     NOT NULL DEFAULT false,
      sentiment_visual      TEXT        NOT NULL DEFAULT 'neutral',
      source_url            TEXT        NOT NULL,
      confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.65,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_visual_osint_biz ON visual_osint_signals(business_id, created_at DESC)`,

    // retention_alerts — RetentionSentinel output
    `CREATE TABLE IF NOT EXISTS retention_alerts (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id           UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_identifier   TEXT        NOT NULL,
      risk_level            TEXT        NOT NULL DEFAULT 'low',
      churn_probability     NUMERIC(4,3) NOT NULL DEFAULT 0.1,
      last_interaction_days INT         NOT NULL DEFAULT 0,
      recommended_offer     TEXT        NOT NULL DEFAULT '',
      source_url            TEXT        NOT NULL,
      confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.75,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_retention_biz ON retention_alerts(business_id, created_at DESC)`,

    // pricing_recommendations — NegotiationPricingCoach output
    `CREATE TABLE IF NOT EXISTS pricing_recommendations (
      id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id                UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      lead_context               TEXT        NOT NULL DEFAULT '',
      market_supply              TEXT        NOT NULL DEFAULT 'balanced',
      competitor_avg_price       NUMERIC(10,2),
      recommended_price_modifier NUMERIC(5,2) NOT NULL DEFAULT 0,
      recommended_tactic         TEXT        NOT NULL DEFAULT 'standard',
      tactic_reason              TEXT        NOT NULL DEFAULT '',
      confidence_pct             INT         NOT NULL DEFAULT 70,
      valid_until                TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_url                 TEXT        NOT NULL,
      confidence_score           NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pricing_biz ON pricing_recommendations(business_id, created_at DESC)`,

    // campaign_drafts — CampaignAutopilot output
    `CREATE TABLE IF NOT EXISTS campaign_drafts (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      trigger_event    TEXT        NOT NULL DEFAULT '',
      platform         TEXT        NOT NULL DEFAULT 'instagram',
      headline         TEXT        NOT NULL DEFAULT '',
      body_text        TEXT        NOT NULL DEFAULT '',
      cta_text         TEXT        NOT NULL DEFAULT '',
      estimated_reach  INT         NOT NULL DEFAULT 300,
      recommended_time TIMESTAMPTZ,
      duration_hours   INT         NOT NULL DEFAULT 24,
      auto_publish     BOOLEAN     NOT NULL DEFAULT false,
      status           TEXT        NOT NULL DEFAULT 'draft',
      source_url       TEXT        NOT NULL,
      confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.78,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_drafts_biz ON campaign_drafts(business_id, created_at DESC)`,

    // expansion_opportunities — ServiceExpansionScout output
    `CREATE TABLE IF NOT EXISTS expansion_opportunities (
      id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id               UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      opportunity_title         TEXT        NOT NULL DEFAULT '',
      unmet_demand_description  TEXT        NOT NULL DEFAULT '',
      demand_signal_count       INT         NOT NULL DEFAULT 0,
      geo                       TEXT,
      estimated_monthly_revenue NUMERIC(12,2),
      estimated_investment      NUMERIC(12,2),
      roi_months                INT,
      source_url                TEXT        NOT NULL,
      confidence_score          NUMERIC(3,2) NOT NULL DEFAULT 0.7,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_expansion_biz ON expansion_opportunities(business_id, created_at DESC)`,

    // reputation_incidents — ReputationWarRoom output
    `CREATE TABLE IF NOT EXISTS reputation_incidents (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id          UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      severity             TEXT        NOT NULL DEFAULT 'low',
      incident_type        TEXT        NOT NULL DEFAULT 'routine_scan',
      description          TEXT        NOT NULL DEFAULT '',
      recommended_response TEXT        NOT NULL DEFAULT '',
      response_deadline    TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved             BOOLEAN     NOT NULL DEFAULT false,
      source_url           TEXT        NOT NULL,
      confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.82,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reputation_biz ON reputation_incidents(business_id, created_at DESC)`,

    // ── automation_logs: missing columns added to schema but not yet in DB ───
    `ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS trace_id           TEXT`,
    `ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS high_urgency_count DOUBLE PRECISION DEFAULT 0`,

    // ── KAN-121: Competitor Google review ingest ──────────────────────────────
    `ALTER TABLE reviews     ADD COLUMN IF NOT EXISTS linked_competitor TEXT`,
    `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS google_place_id   TEXT`,

    // ── KAN-120: Dedup guard — partial unique index on google_review_id ──────
    `CREATE UNIQUE INDEX IF NOT EXISTS reviews_google_review_id_unique ON reviews (linked_business, google_review_id) WHERE google_review_id IS NOT NULL`,
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      const label = sql.trim().split('\n')[0].substring(0, 60);
      results.push(`OK: ${label}`);
    } catch (err: any) {
      const label = sql.trim().split('\n')[0].substring(0, 60);
      errors.push(`ERR: ${label} — ${err.message}`);
    }
  }

  console.log('[migrate] Results:', results);
  if (errors.length) console.error('[migrate] Errors:', errors);

  return res.json({
    ok: errors.length === 0,
    executed: results.length,
    results,
    errors,
  });
});

export default router;
