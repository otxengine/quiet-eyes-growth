-- OTXEngine — v8 Migration: Patent Compliance Gaps 2, 3
-- Gap 2: Routing Rule Store (patent FIGURE 2 element 235, §[0029])
--        Rules moved from hardcoded TypeScript → configurable DB table
-- Gap 3: Signal Objects unified schema (patent claim 1 step 6, §[0041]-[0043])
--        Common data schema table for normalized signal objects

-- ─── Gap 2: routing_rules ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routing_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  agent       text        NOT NULL,
  priority    int         NOT NULL DEFAULT 5,
  condition   text        NOT NULL DEFAULT 'always',
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_event_type
  ON routing_rules(event_type) WHERE enabled = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_rules_event_agent
  ON routing_rules(event_type, agent);

COMMENT ON TABLE routing_rules IS
  'Patent §[0029] / FIGURE 2 element 235 — Routing Rule Store.
   Rules maintained independently of all autonomous software agents.
   Loaded by BusPublisher at runtime with 5-min in-memory cache.
   Fallback: hardcoded EVENT_ROUTING map in bus_publisher.ts.';

-- Seed with current EVENT_ROUTING rules from bus_publisher.ts
INSERT INTO routing_rules (event_type, agent, priority, condition) VALUES
  -- new_signal (Layer 1 → Layer 2)
  ('new_signal', 'IntentClassification',    1, 'always'),
  ('new_signal', 'SectorTrendRadar',        2, 'always'),
  ('new_signal', 'HyperLocalContextAgent',  3, 'has_geo_coordinates'),
  ('new_signal', 'NegotiationPricingCoach', 4, 'intent_score > 0.65'),
  -- signal_qualified (Layer 2 → Layer 3 + Layer 5)
  ('signal_qualified', 'ActionScoringService',      1, 'intent_score > 0.65'),
  ('signal_qualified', 'SyntheticPersonaSimulator', 3, 'always'),
  ('signal_qualified', 'ResourceArbitrageAgent',    4, 'demand_delta < -15'),
  -- trend_spike (Layer 2 → Layer 4 + Layer 6 + Layer 7)
  ('trend_spike', 'InfluenceIntegrityAuditor', 1, 'always'),
  ('trend_spike', 'ViralCatalyst',             2, 'z_score > 2.5'),
  ('trend_spike', 'ActionScoringService',      3, 'z_score > 2.0'),
  ('trend_spike', 'CrossSectorBridgeAgent',    4, 'always'),
  ('trend_spike', 'ResourceArbitrageAgent',    5, 'always'),
  -- local_event_detected (Layer 5 → weather + forecaster + scoring)
  ('local_event_detected', 'WeatherDemandPredictor', 1, 'always'),
  ('local_event_detected', 'MicroDemandForecaster',  2, 'always'),
  ('local_event_detected', 'ActionScoringService',   1, 'attendance > 500'),
  ('local_event_detected', 'ResourceArbitrageAgent', 2, 'attendance > 200'),
  -- demand_gap_forecast
  ('demand_gap_forecast', 'ResourceArbitrageAgent', 1, 'demand_delta < -15'),
  ('demand_gap_forecast', 'MicroDemandForecaster',  2, 'always'),
  ('demand_gap_forecast', 'ActionScoringService',   1, 'demand_delta < -20'),
  -- competitor_change
  ('competitor_change', 'ActionScoringService',      1, 'always'),
  ('competitor_change', 'CrossSectorBridgeAgent',    3, 'change_type = price'),
  ('competitor_change', 'SyntheticPersonaSimulator', 4, 'change_type = price'),
  -- persona_updated
  ('persona_updated', 'ActionScoringService', 2, 'always'),
  ('persona_updated', 'MarketMemoryEngine',   5, 'personas_count >= 3'),
  -- cross_sector_opportunity
  ('cross_sector_opportunity', 'ActionScoringService',   2, 'correlation_score > 0.65'),
  ('cross_sector_opportunity', 'HyperLocalContextAgent', 3, 'always'),
  -- arbitrage_action_ready
  ('arbitrage_action_ready', 'ActionScoringService', 1, 'always'),
  -- action_scored (Layer 4 → Layer 3)
  ('action_scored', 'MarketMemoryEngine', 5, 'action_score > 0.60'),
  -- memory_updated (closes learning loop)
  ('memory_updated', 'ActionScoringService',      3, 'always'),
  ('memory_updated', 'SyntheticPersonaSimulator', 5, 'always'),
  ('memory_updated', 'ResourceArbitrageAgent',    5, 'always'),
  -- config_updated
  ('config_updated', 'SignalCollector',        1, 'always'),
  ('config_updated', 'IntentClassification',   1, 'always'),
  ('config_updated', 'SectorTrendRadar',       1, 'always'),
  ('config_updated', 'HyperLocalContextAgent', 2, 'always'),
  ('config_updated', 'CompetitorSnapshot',     2, 'always'),
  -- Layer 7 event routing
  ('viral_pattern_detected',        'CampaignAutoPilot',          1, 'virality_score > 0.70'),
  ('viral_pattern_detected',        'ActionScoringService',        2, 'always'),
  ('trend_verified',                'ActionScoringService',        2, 'always'),
  ('trend_manipulated',             'ActionScoringService',        1, 'always'),
  ('visual_insight_detected',       'ServiceExpansionScout',       2, 'always'),
  ('visual_insight_detected',       'ActionScoringService',        3, 'always'),
  ('churn_risk_detected',           'NegotiationPricingCoach',     3, 'risk_level = critical'),
  ('churn_risk_detected',           'CampaignAutoPilot',           4, 'risk_level = high'),
  ('expansion_opportunity_detected','SyntheticPersonaSimulator',   3, 'always'),
  ('expansion_opportunity_detected','ActionScoringService',        2, 'confidence_score > 0.70'),
  ('reputation_incident_detected',  'ActionScoringService',        1, 'severity = critical')
ON CONFLICT (event_type, agent) DO NOTHING;

-- ─── Gap 3: signal_objects — common data schema ───────────────────────────────

CREATE TABLE IF NOT EXISTS signal_objects (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  signal_type      text        NOT NULL,   -- buyer_intent | trend_spike | local_event | competitor | cross_sector | demand_gap | persona
  source_agent     text        NOT NULL,
  source_record_id text,
  source_table     text,
  weight           float       NOT NULL DEFAULT 0.5,
  payload          jsonb       NOT NULL DEFAULT '{}',
  contextual_attrs jsonb       NOT NULL DEFAULT '{}',  -- confidence, geo_match, intent_score, etc.
  fused_insight_id uuid,                               -- set after InsightFusion consumes this signal
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_objects_business_id
  ON signal_objects(business_id);
CREATE INDEX IF NOT EXISTS idx_signal_objects_created_at
  ON signal_objects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_objects_type
  ON signal_objects(signal_type);

COMMENT ON TABLE signal_objects IS
  'Patent claim 1 step 6 — normalized signal objects conforming to a common data schema.
   Written by InsightFusionEngine when building the composite signal representation.
   Each row is one weighted signal input from an autonomous software agent.
   signal_type values: buyer_intent | trend_spike | local_event | competitor | cross_sector | demand_gap | persona';
