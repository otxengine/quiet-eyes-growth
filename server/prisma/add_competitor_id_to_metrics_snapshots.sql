-- Safe to re-run on an already-created table.
ALTER TABLE metrics_snapshots ADD COLUMN IF NOT EXISTS competitor_id TEXT;
CREATE INDEX IF NOT EXISTS metrics_snapshots_lookup_idx ON metrics_snapshots (linked_business, competitor_id, metric_name, snapshot_date);
