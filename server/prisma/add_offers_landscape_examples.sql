-- Safe to re-run on an already-created table.
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS offers_landscape_examples TEXT;
