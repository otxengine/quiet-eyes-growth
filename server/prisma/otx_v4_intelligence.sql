-- =============================================================================
-- OTXEngine v4 — Intelligence Layer Schema
-- =============================================================================
-- New tables for structured intelligence output from MarketIntelligenceService:
--   market_insights      — structured Insight objects from all 8 engines
--   otx_trust_snapshots  — TrustState snapshots per business per run
--   otx_churn_risk_logs  — ChurnRiskState logs per business per run
-- =============================================================================

-- ─── market_insights ──────────────────────────────────────────────────────────
-- Stores structured Insight objects produced by intelligence engines.
-- One insight per (business_id, dedup_key) with conflict-merge on update.

CREATE TABLE IF NOT EXISTS market_insights (
  id                        TEXT        PRIMARY KEY,
  business_id               TEXT        NOT NULL,
  engine                    TEXT        NOT NULL,   -- producing engine name
  type                      TEXT        NOT NULL,   -- InsightType enum
  category                  TEXT        NOT NULL,   -- 'opportunity'|'threat'|'optimization'|'retention'|'trust'
  title                     TEXT        NOT NULL,
  summary                   TEXT        NOT NULL,
  supporting_signals        JSONB       NOT NULL DEFAULT '[]',
  confidence                NUMERIC(5,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  urgency                   TEXT        NOT NULL,   -- 'low'|'medium'|'high'|'critical'
  business_fit              NUMERIC(5,3) NOT NULL CHECK (business_fit BETWEEN 0 AND 1),
  timeframe                 TEXT        NOT NULL,   -- 'immediate'|'24h'|'7d'|'30d'
  estimated_impact          TEXT        NOT NULL,   -- 'low'|'medium'|'high'|'critical'
  recommended_action_types  JSONB       NOT NULL DEFAULT '[]',
  metadata                  JSONB       NOT NULL DEFAULT '{}',
  dedup_key                 TEXT        NOT NULL,
  trace_id                  TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_market_insights_dedup UNIQUE (business_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_market_insights_business_id
  ON market_insights (business_id);

CREATE INDEX IF NOT EXISTS idx_market_insights_type
  ON market_insights (type);

CREATE INDEX IF NOT EXISTS idx_market_insights_urgency
  ON market_insights (urgency);

CREATE INDEX IF NOT EXISTS idx_market_insights_created_at
  ON market_insights (created_at DESC);

COMMENT ON TABLE market_insights IS
  'Structured intelligence output from MarketIntelligenceService engines. One record per (business, dedup_key), updated on conflict.';

-- ─── otx_trust_snapshots ──────────────────────────────────────────────────────
-- Stores TrustState per business per pipeline run for trend tracking.

CREATE TABLE IF NOT EXISTS otx_trust_snapshots (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id       TEXT        NOT NULL,
  trace_id          TEXT,
  trust_score       INTEGER     NOT NULL,   -- 0–100
  vs_competitors    NUMERIC(4,2),           -- -1 to +1
  review_velocity   NUMERIC(5,2),
  response_rate     NUMERIC(4,2),
  signal_strength   TEXT,                   -- 'weak'|'moderate'|'strong'
  gap_type          TEXT        NOT NULL,   -- 'lagging'|'on_par'|'leading'
  recommendations   JSONB       NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otx_trust_business_id
  ON otx_trust_snapshots (business_id, created_at DESC);

COMMENT ON TABLE otx_trust_snapshots IS
  'Time-series trust score snapshots. Used for trend analysis and learning signal.';

-- ─── otx_churn_risk_logs ──────────────────────────────────────────────────────
-- Stores ChurnRiskState per business per pipeline run.

CREATE TABLE IF NOT EXISTS otx_churn_risk_logs (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id           TEXT        NOT NULL,
  trace_id              TEXT,
  risk_level            TEXT        NOT NULL,   -- 'low'|'medium'|'high'|'critical'
  risk_score            NUMERIC(5,3) NOT NULL,
  indicators            JSONB       NOT NULL DEFAULT '[]',
  estimated_churn_pct   NUMERIC(4,2),
  top_risk_factor       TEXT,
  window_days           INTEGER     NOT NULL DEFAULT 30,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otx_churn_business_id
  ON otx_churn_risk_logs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_otx_churn_risk_level
  ON otx_churn_risk_logs (risk_level);

COMMENT ON TABLE otx_churn_risk_logs IS
  'Churn risk predictions from InvisibleChurnPredictor. Time-series log for trend analysis.';

-- ─── market_insights upsert trigger ──────────────────────────────────────────
-- Auto-update updated_at on conflict

CREATE OR REPLACE FUNCTION market_insights_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS market_insights_updated_at ON market_insights;
CREATE TRIGGER market_insights_updated_at
  BEFORE UPDATE ON market_insights
  FOR EACH ROW EXECUTE FUNCTION market_insights_set_updated_at();

-- ─── View: latest trust per business ─────────────────────────────────────────

CREATE OR REPLACE VIEW v_latest_trust AS
SELECT DISTINCT ON (business_id)
  business_id,
  trust_score,
  vs_competitors,
  gap_type,
  signal_strength,
  response_rate,
  created_at
FROM otx_trust_snapshots
ORDER BY business_id, created_at DESC;

COMMENT ON VIEW v_latest_trust IS
  'Most recent trust snapshot per business — used by dashboard and ContextBuilder.';

-- ─── View: latest churn risk per business ────────────────────────────────────

CREATE OR REPLACE VIEW v_latest_churn_risk AS
SELECT DISTINCT ON (business_id)
  business_id,
  risk_level,
  risk_score,
  estimated_churn_pct,
  top_risk_factor,
  created_at
FROM otx_churn_risk_logs
ORDER BY business_id, created_at DESC;

COMMENT ON VIEW v_latest_churn_risk IS
  'Most recent churn risk per business — used by dashboard and retention decisions.';

-- ─── View: intelligence summary per business ─────────────────────────────────

CREATE OR REPLACE VIEW v_market_intelligence_summary AS
SELECT
  business_id,
  COUNT(*)                                                         AS total_insights,
  COUNT(*) FILTER (WHERE urgency = 'critical')                     AS critical_count,
  COUNT(*) FILTER (WHERE urgency = 'high')                         AS high_count,
  COUNT(*) FILTER (WHERE category = 'opportunity')                 AS opportunity_count,
  COUNT(*) FILTER (WHERE category = 'threat')                      AS threat_count,
  COUNT(*) FILTER (WHERE category = 'retention')                   AS retention_count,
  COUNT(*) FILTER (WHERE category = 'trust')                       AS trust_count,
  MAX(created_at)                                                  AS last_updated
FROM market_insights
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY business_id;

COMMENT ON VIEW v_market_intelligence_summary IS
  'Aggregated intelligence counts per business for the last 7 days.';
