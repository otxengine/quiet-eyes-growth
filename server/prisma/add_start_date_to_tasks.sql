-- Safe to re-run on an already-created table.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date TEXT;
