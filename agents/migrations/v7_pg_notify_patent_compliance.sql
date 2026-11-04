-- OTXEngine Migration v7 — Patent Compliance: pg_notify + action states + user guidelines
-- Addresses three gaps identified in patent OTX-001-r04:
--   Gap 1: Implement pg_notify/LISTEN trigger on agent_data_bus (patent §[0029])
--   Gap 2: Add status state-machine to actions_recommended (patent §[0073], claim 6)
--   Gap 3: Add user_guidelines to meta_configurations (patent §[0025]-[0026], §[0071])
-- Run after v6_schema_fixes.sql.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- GAP 1: pg_notify trigger on agent_data_bus
-- The patent (§[0029]) specifies: "the shared event store is implemented using
-- a relational database, and the indication is communicated using a
-- publish-subscribe notification mechanism of the relational database, such as
-- the LISTEN/NOTIFY mechanism of a PostgreSQL database, wherein one or more of
-- the autonomous software agents subscribe to a notification channel and receive
-- notifications generated using pg_notify."
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Trigger function: fires pg_notify on every INSERT into agent_data_bus.
-- Payload is a compact JSON with the fields needed by the listener to route
-- the event without an additional DB round-trip.
CREATE OR REPLACE FUNCTION notify_agent_bus()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'id',           NEW.id,
      'business_id',  NEW.business_id,
      'event_type',   NEW.event_type,
      'source_agent', NEW.source_agent,
      'target_agents',NEW.target_agents,
      'priority',     NEW.priority,
      'payload',      NEW.payload
    )::text
  );
  RETURN NEW;
END;
$$;

-- Attach trigger to agent_data_bus — fires AFTER each INSERT row.
DROP TRIGGER IF EXISTS trg_agent_bus_notify ON agent_data_bus;
CREATE TRIGGER trg_agent_bus_notify
  AFTER INSERT ON agent_data_bus
  FOR EACH ROW
  EXECUTE FUNCTION notify_agent_bus();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- GAP 2: Action state-machine on actions_recommended
-- The patent (claim 6 / §[0073]) requires: draft → approved → rejected / published.
-- "The action data is placed in the draft state upon generation by the action
--  generation module. Responsive to approval by the user, the action data
--  transitions to the approved state... the action data transitions to the
--  approved state automatically when the action data satisfies the one or more
--  user-specified guidelines."
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE actions_recommended
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: existing rows that scored above threshold were implicitly approved
UPDATE actions_recommended
  SET status = 'approved', auto_approved = TRUE
  WHERE action_score >= 0.60 AND status = 'draft';

CREATE INDEX IF NOT EXISTS idx_actions_status
  ON actions_recommended(business_id, status)
  WHERE status IN ('draft', 'approved');

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- GAP 3: User-specified guidelines in meta_configurations
-- The patent (§[0025]-[0026], §[0071]) requires guidelines such as:
-- budget constraint, spending limit, permitted action type, permitted target,
-- permitted time window — stored as user configuration data and used by the
-- scoring module to auto-approve or block actions.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE meta_configurations
  ADD COLUMN IF NOT EXISTS user_guidelines JSONB NOT NULL DEFAULT '{
    "max_ad_budget_ils":        500,
    "permitted_action_types":   ["promote", "respond", "alert"],
    "permitted_platforms":      ["instagram", "facebook", "whatsapp"],
    "auto_approve_score_min":   0.72,
    "permitted_publish_hours":  {"start": 8, "end": 22},
    "max_daily_actions":        5
  }'::jsonb;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Integrity checks
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
BEGIN
  -- Verify pg_notify trigger exists
  PERFORM tgname FROM pg_trigger
    WHERE tgname = 'trg_agent_bus_notify';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pg_notify trigger trg_agent_bus_notify not created';
  END IF;

  -- Verify status column added to actions_recommended
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'actions_recommended' AND column_name = 'status';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'status column not added to actions_recommended';
  END IF;

  -- Verify user_guidelines column added to meta_configurations
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'meta_configurations' AND column_name = 'user_guidelines';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_guidelines column not added to meta_configurations';
  END IF;

  RAISE NOTICE 'v7 patent compliance migration: all checks passed OK';
END $$;
