-- Add lead criteria text fields to business_profiles
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS lead_intent_signals TEXT,
  ADD COLUMN IF NOT EXISTS lead_quality_notes TEXT;
