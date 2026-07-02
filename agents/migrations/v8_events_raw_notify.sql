-- KAN-42: pg_notify trigger on events_raw INSERT
-- Notifies EventImpactEngine via agent_bus channel on every new event row.
-- Safe to re-run (CREATE OR REPLACE + DROP IF EXISTS guards).

CREATE OR REPLACE FUNCTION notify_new_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'event_type',   'local_event_detected',
      'record_id',    NEW.event_id,
      'event_name',   NEW.event_name,
      'event_date',   NEW.event_date,
      'geo',          NEW.geo,
      'source_table', 'events_raw'
    )::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_new_event ON events_raw;
CREATE TRIGGER trg_notify_new_event
  AFTER INSERT ON events_raw
  FOR EACH ROW EXECUTE FUNCTION notify_new_event();
