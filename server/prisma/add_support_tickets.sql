-- Migration: add support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT,
  user_email    TEXT,
  business_id   TEXT,
  description   TEXT        NOT NULL,
  status        TEXT        DEFAULT 'open',
  recording_url TEXT
);
