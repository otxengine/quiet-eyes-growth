-- OTXEngine — Migration v3: Agent Data Bus
-- Creates agent_data_bus table, pg_notify triggers, array_append_unique RPC,
-- and a nightly cleanup function.

-- ─── 1. Main bus table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_data_bus (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Source
  source_agent      TEXT        NOT NULL,
  source_record_id  UUID        NOT NULL,
  source_table      TEXT        NOT NULL,

  -- Payload
  event_type        TEXT        NOT NULL CHECK (event_type IN (
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
    'config_updated'
  )),
  payload           JSONB       NOT NULL DEFAULT '{}',
  priority          INT         NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

  -- Routing
  target_agents     TEXT[]      NOT NULL DEFAULT '{}',
  consumed_by       TEXT[]      NOT NULL DEFAULT '{}',

  -- Lifecycle
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '4 hours'),
  processed         BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_bus_business_event
  ON agent_data_bus(business_id, event_type, processed);

CREATE INDEX IF NOT EXISTS idx_bus_priority
  ON agent_data_bus(priority, created_at)
  WHERE processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_bus_expires
  ON agent_data_bus(expires_at)
  WHERE processed = FALSE;

-- ─── 2. array_append_unique RPC ──────────────────────────────────────────────
-- Used by bus_consumer to mark consumed_by without duplicates

CREATE OR REPLACE FUNCTION array_append_unique(arr TEXT[], val TEXT)
RETURNS TEXT[] AS $$
BEGIN
  IF val = ANY(arr) THEN
    RETURN arr;
  END IF;
  RETURN array_append(arr, val);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── 3. pg_notify trigger on agent_data_bus INSERT ───────────────────────────
-- Fires immediately when any new event lands on the bus

CREATE OR REPLACE FUNCTION notify_agent_bus()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'id',           NEW.id,
      'business_id',  NEW.business_id,
      'event_type',   NEW.event_type,
      'priority',     NEW.priority,
      'source_agent', NEW.source_agent
    )::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_agent_bus ON agent_data_bus;
CREATE TRIGGER trg_notify_agent_bus
  AFTER INSERT ON agent_data_bus
  FOR EACH ROW EXECUTE FUNCTION notify_agent_bus();

-- ─── 4. pg_notify trigger on signals_raw INSERT ──────────────────────────────
-- Agents downstream don't need to poll — they're notified immediately

CREATE OR REPLACE FUNCTION notify_new_signal()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'event_type',   'new_signal',
      'business_id',  NEW.business_id,
      'record_id',    NEW.id,
      'source_table', 'signals_raw'
    )::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_new_signal ON signals_raw;
CREATE TRIGGER trg_notify_new_signal
  AFTER INSERT ON signals_raw
  FOR EACH ROW EXECUTE FUNCTION notify_new_signal();

-- ─── 5. pg_notify trigger on classified_signals INSERT ───────────────────────

CREATE OR REPLACE FUNCTION notify_signal_qualified()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qualified = TRUE THEN
    PERFORM pg_notify(
      'agent_bus',
      json_build_object(
        'event_type',   'signal_qualified',
        'business_id',  NEW.business_id,
        'record_id',    NEW.id,
        'intent_score', NEW.intent_score,
        'source_table', 'classified_signals'
      )::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_signal_qualified ON classified_signals;
CREATE TRIGGER trg_notify_signal_qualified
  AFTER INSERT ON classified_signals
  FOR EACH ROW EXECUTE FUNCTION notify_signal_qualified();

-- ─── 6. pg_notify trigger on sector_trends INSERT (spike only) ───────────────

CREATE OR REPLACE FUNCTION notify_trend_spike()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.spike_detected = TRUE THEN
    PERFORM pg_notify(
      'agent_bus',
      json_build_object(
        'event_type',   'trend_spike',
        'business_id',  NEW.business_id,
        'record_id',    NEW.id,
        'z_score',      NEW.z_score,
        'sector',       NEW.sector,
        'source_table', 'sector_trends'
      )::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_trend_spike ON sector_trends;
CREATE TRIGGER trg_notify_trend_spike
  AFTER INSERT ON sector_trends
  FOR EACH ROW EXECUTE FUNCTION notify_trend_spike();

-- ─── 7. pg_notify trigger on hyper_local_events INSERT ───────────────────────

CREATE OR REPLACE FUNCTION notify_local_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'event_type',   'local_event_detected',
      'business_id',  NEW.business_id,
      'record_id',    NEW.id,
      'attendance',   NEW.expected_attendance,
      'event_type_v', NEW.event_type,
      'source_table', 'hyper_local_events'
    )::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_local_event ON hyper_local_events;
CREATE TRIGGER trg_notify_local_event
  AFTER INSERT ON hyper_local_events
  FOR EACH ROW EXECUTE FUNCTION notify_local_event();

-- ─── 8. pg_notify trigger on competitor_changes INSERT ───────────────────────

CREATE OR REPLACE FUNCTION notify_competitor_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'event_type',   'competitor_change',
      'business_id',  NEW.business_id,
      'record_id',    NEW.id,
      'change_type',  NEW.change_type,
      'source_table', 'competitor_changes'
    )::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_competitor_change ON competitor_changes;
CREATE TRIGGER trg_notify_competitor_change
  AFTER INSERT ON competitor_changes
  FOR EACH ROW EXECUTE FUNCTION notify_competitor_change();

-- ─── 9. Nightly cleanup function ─────────────────────────────────────────────
-- Bus events expire and must not accumulate. Run via pg_cron or Deno cron.

CREATE OR REPLACE FUNCTION cleanup_agent_bus()
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM agent_data_bus
  WHERE expires_at < now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ─── 10. Verify migration ─────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'agent_data_bus'
  ), 'agent_data_bus table not created';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'array_append_unique'
  ), 'array_append_unique function not created';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'cleanup_agent_bus'
  ), 'cleanup_agent_bus function not created';

  RAISE NOTICE 'v3_agent_data_bus migration verified OK';
END $$;
