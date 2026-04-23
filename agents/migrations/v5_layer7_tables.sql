-- OTXEngine Migration v5 — Layer 7 Advanced Agents Tables (18-25)
-- Run in Supabase SQL editor after v4.

-- ── Table 18: viral_patterns ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS viral_patterns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID        NOT NULL REFERENCES businesses(id),
  pattern_type     TEXT        NOT NULL CHECK (pattern_type IN ('format','music','hashtag','timing','hook')),
  pattern_value    TEXT        NOT NULL,
  platform         TEXT        NOT NULL CHECK (platform IN ('tiktok','instagram','facebook','youtube')),
  virality_score   NUMERIC(4,3),
  geo_relevance    TEXT,
  peak_hour        INT,
  sample_size      INT,
  script_template  TEXT,
  detected_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url       TEXT        NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_viral_patterns_business ON viral_patterns(business_id);
CREATE INDEX IF NOT EXISTS idx_viral_patterns_virality ON viral_patterns(virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_viral_patterns_detected ON viral_patterns(detected_at_utc DESC);
ALTER TABLE viral_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_viral_patterns" ON viral_patterns FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 19: influence_integrity_scores ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS influence_integrity_scores (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID        NOT NULL REFERENCES businesses(id),
  trend_id             UUID        REFERENCES sector_trends(id),
  organic_pct          NUMERIC(4,1),
  bot_pct              NUMERIC(4,1),
  coordinated_pct      NUMERIC(4,1),
  verdict              TEXT        NOT NULL CHECK (verdict IN ('organic','suspicious','manipulated')),
  graph_density        NUMERIC(5,4),
  account_age_avg_days INT,
  recommendation       TEXT,
  source_url           TEXT        NOT NULL,
  detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score     NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_integrity_business ON influence_integrity_scores(business_id);
CREATE INDEX IF NOT EXISTS idx_integrity_trend    ON influence_integrity_scores(trend_id);
CREATE INDEX IF NOT EXISTS idx_integrity_verdict  ON influence_integrity_scores(verdict);
ALTER TABLE influence_integrity_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_integrity" ON influence_integrity_scores FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 20: visual_osint_signals ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visual_osint_signals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID        NOT NULL REFERENCES businesses(id),
  media_url             TEXT        NOT NULL,
  platform              TEXT        NOT NULL,
  detected_objects      JSONB,
  scene_tags            TEXT[],
  business_insight      TEXT,
  unmet_demand_detected BOOLEAN     DEFAULT FALSE,
  sentiment_visual      TEXT        CHECK (sentiment_visual IN ('positive','neutral','negative','urgent')),
  geo                   TEXT,
  source_url            TEXT        NOT NULL,
  detected_at_utc       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score      NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_visual_osint_business ON visual_osint_signals(business_id);
CREATE INDEX IF NOT EXISTS idx_visual_osint_unmet    ON visual_osint_signals(unmet_demand_detected) WHERE unmet_demand_detected = TRUE;
CREATE INDEX IF NOT EXISTS idx_visual_osint_detected ON visual_osint_signals(detected_at_utc DESC);
ALTER TABLE visual_osint_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_visual_osint" ON visual_osint_signals FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 21: retention_alerts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retention_alerts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID        NOT NULL REFERENCES businesses(id),
  customer_identifier   TEXT        NOT NULL,
  risk_level            TEXT        NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  churn_probability     NUMERIC(4,3),
  last_interaction_days INT,
  external_signal       TEXT,
  external_signal_url   TEXT,
  recommended_offer     TEXT,
  offer_sent            BOOLEAN     DEFAULT FALSE,
  source_url            TEXT        NOT NULL DEFAULT 'internal://retention-sentinel',
  detected_at_utc       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score      NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_retention_business   ON retention_alerts(business_id);
CREATE INDEX IF NOT EXISTS idx_retention_risk       ON retention_alerts(risk_level);
CREATE INDEX IF NOT EXISTS idx_retention_churn      ON retention_alerts(churn_probability DESC);
CREATE INDEX IF NOT EXISTS idx_retention_offer_sent ON retention_alerts(offer_sent) WHERE offer_sent = FALSE;
ALTER TABLE retention_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_retention" ON retention_alerts FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 22: pricing_recommendations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                UUID        NOT NULL REFERENCES businesses(id),
  lead_context               TEXT,
  market_supply              TEXT        CHECK (market_supply IN ('scarce','balanced','flooded')),
  competitor_avg_price       NUMERIC(10,2),
  recommended_price_modifier NUMERIC(5,2),
  recommended_tactic         TEXT        CHECK (recommended_tactic IN ('premium','standard','discount','bundle')),
  tactic_reason              TEXT,
  confidence_pct             INT,
  valid_until                TIMESTAMPTZ,
  source_url                 TEXT        NOT NULL,
  detected_at_utc            TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score           NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_pricing_business    ON pricing_recommendations(business_id);
CREATE INDEX IF NOT EXISTS idx_pricing_valid_until ON pricing_recommendations(valid_until);
CREATE INDEX IF NOT EXISTS idx_pricing_tactic      ON pricing_recommendations(recommended_tactic);
ALTER TABLE pricing_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_pricing" ON pricing_recommendations FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 23: campaign_drafts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_drafts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID        NOT NULL REFERENCES businesses(id),
  trigger_event    TEXT        NOT NULL,
  platform         TEXT        NOT NULL,
  headline         TEXT        NOT NULL,
  body_text        TEXT        NOT NULL,
  cta_text         TEXT        NOT NULL,
  target_audience  JSONB,
  geo_radius_km    INT         DEFAULT 5,
  recommended_time TIMESTAMPTZ,
  duration_hours   INT         DEFAULT 24,
  estimated_reach  INT,
  auto_publish     BOOLEAN     DEFAULT FALSE,
  status           TEXT        DEFAULT 'draft' CHECK (status IN ('draft','approved','published','rejected')),
  source_url       TEXT        NOT NULL DEFAULT 'internal://campaign-autopilot',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaign_drafts(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status   ON campaign_drafts(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_platform ON campaign_drafts(platform);
CREATE INDEX IF NOT EXISTS idx_campaigns_created  ON campaign_drafts(created_at DESC);
ALTER TABLE campaign_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_campaigns" ON campaign_drafts FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 24: expansion_opportunities ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expansion_opportunities (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID        NOT NULL REFERENCES businesses(id),
  opportunity_title         TEXT        NOT NULL,
  unmet_demand_description  TEXT        NOT NULL,
  demand_signal_count       INT,
  geo                       TEXT,
  estimated_monthly_revenue NUMERIC(10,2),
  estimated_investment      NUMERIC(10,2),
  roi_months                INT,
  lead_examples             JSONB,
  source_signal_ids         UUID[],
  source_url                TEXT        NOT NULL,
  detected_at_utc           TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score          NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_expansion_business   ON expansion_opportunities(business_id);
CREATE INDEX IF NOT EXISTS idx_expansion_confidence ON expansion_opportunities(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_expansion_roi        ON expansion_opportunities(roi_months);
ALTER TABLE expansion_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_expansion" ON expansion_opportunities FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Table 25: reputation_incidents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_incidents (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID        NOT NULL REFERENCES businesses(id),
  severity             TEXT        NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  incident_type        TEXT        CHECK (incident_type IN ('negative_review_spike','viral_complaint','competitor_attack','fake_reviews','media_mention')),
  description          TEXT        NOT NULL,
  affected_platforms   TEXT[],
  recommended_response TEXT,
  response_deadline    TIMESTAMPTZ,
  resolved             BOOLEAN     DEFAULT FALSE,
  source_url           TEXT        NOT NULL,
  detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_score     NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);
CREATE INDEX IF NOT EXISTS idx_reputation_business ON reputation_incidents(business_id);
CREATE INDEX IF NOT EXISTS idx_reputation_severity ON reputation_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_reputation_resolved ON reputation_incidents(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_reputation_deadline ON reputation_incidents(response_deadline);
ALTER TABLE reputation_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_reputation" ON reputation_incidents FOR ALL USING (
  business_id = auth.uid()::uuid
);

-- ── Integrity check ───────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl TEXT;
  cnt INT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'viral_patterns','influence_integrity_scores','visual_osint_signals',
    'retention_alerts','pricing_recommendations','campaign_drafts',
    'expansion_opportunities','reputation_incidents'
  ] LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I', tbl) INTO cnt;
    RAISE NOTICE 'v5 table % OK (rows: %)', tbl, cnt;
  END LOOP;
END $$;
