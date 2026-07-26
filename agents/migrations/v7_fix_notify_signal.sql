-- KAN-43: Fix notify_new_signal trigger — was referencing NEW.id, column is signal_id

CREATE OR REPLACE FUNCTION notify_new_signal()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'agent_bus',
    json_build_object(
      'event_type',   'new_signal',
      'business_id',  NEW.business_id,
      'record_id',    NEW.signal_id,
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
