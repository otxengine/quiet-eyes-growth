-- OTXEngine Migration v6 — Schema fixes for Layer 7 compatibility
-- Run in Supabase SQL editor after v5.

-- ── Fix 1: Add missing columns to meta_configurations ────────────────────────
-- context_builder.ts SELECTs these fields; v2 migration did not create them.

ALTER TABLE meta_configurations
  ADD COLUMN IF NOT EXISTS primary_kpi              TEXT         DEFAULT 'revenue',
  ADD COLUMN IF NOT EXISTS z_score_spike_threshold  NUMERIC(4,2) DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS intent_threshold         NUMERIC(4,2) DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS version                  INT          DEFAULT 1;

-- Backfill existing rows from configuration_version
UPDATE meta_configurations SET version = configuration_version WHERE version IS NULL;

-- ── Fix 2: Extend agent_data_bus event_type CHECK to include Layer 7 types ───
-- Postgres requires dropping + recreating inline CHECK constraints.
-- We use a table constraint (named) so it can be dropped cleanly.

ALTER TABLE agent_data_bus
  DROP CONSTRAINT IF EXISTS agent_data_bus_event_type_check;

ALTER TABLE agent_data_bus
  ADD CONSTRAINT agent_data_bus_event_type_check
  CHECK (event_type IN (
    -- Layer 1–6 (original)
    'new_signal',
    'signal_qualified',
    'trend_spike',
    'local_event_detected',
    'demand_gap_forecast',
    'competitor_change',
    'persona_updated',
    'cross_sector_opportunity',
    'arbitrage_action_ready',
    'action_scored',
    'memory_updated',
    'config_updated',
    -- Layer 7 (new)
    'viral_pattern_detected',
    'trend_verified',
    'trend_manipulated',
    'visual_insight_detected',
    'churn_risk_detected',
    'pricing_recommendation_ready',
    'campaign_draft_ready',
    'expansion_opportunity_detected',
    'reputation_incident_detected'
  ));

-- ── Integrity check ───────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Verify meta_configurations columns exist
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'meta_configurations' AND column_name = 'primary_kpi';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'primary_kpi column not added to meta_configurations';
  END IF;

  -- Verify CHECK constraint exists
  PERFORM constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'agent_data_bus'
      AND constraint_name = 'agent_data_bus_event_type_check';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_data_bus_event_type_check constraint not found';
  END IF;

  RAISE NOTICE 'v6 schema fixes applied OK';
END $$;
