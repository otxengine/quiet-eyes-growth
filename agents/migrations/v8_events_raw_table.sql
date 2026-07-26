-- KAN-44: Create events_raw table
-- Required by EventCollector (agents/event_collector.ts) for upsert on (event_name, event_date, geo).
-- UNIQUE constraint is the dedup key; event_id is referenced by event_impact_engine and v5 trigger.

CREATE TABLE IF NOT EXISTS events_raw (
  event_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name       TEXT          NOT NULL,
  event_date       DATE          NOT NULL,
  geo              TEXT,
  source_url       TEXT          NOT NULL,
  detected_at_utc  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  confidence_score NUMERIC(3,2)  NOT NULL CHECK (confidence_score BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_raw_dedup
  ON events_raw (event_name, event_date, COALESCE(geo, ''));

CREATE INDEX IF NOT EXISTS idx_events_raw_date
  ON events_raw (event_date);

-- Integrity check
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'events_raw'
  ), 'events_raw table not created';
  RAISE NOTICE 'KAN-44 migration v8: events_raw table verified OK';
END $$;
