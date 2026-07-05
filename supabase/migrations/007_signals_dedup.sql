-- KAN-42: Add dedup hash column + unique constraint to signals_raw
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS guards).

ALTER TABLE signals_raw
  ADD COLUMN IF NOT EXISTS text_hash TEXT
    GENERATED ALWAYS AS (md5(business_id::text || source_url || raw_text)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_signals_raw_dedup
  ON signals_raw(text_hash);
