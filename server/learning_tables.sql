-- Learning Engine Tables — paste this into Supabase SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS ai_outputs (
  id              TEXT        PRIMARY KEY,
  created_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business TEXT,
  agent_name      TEXT,
  module          TEXT,
  output_type     TEXT,
  content         TEXT,
  context_used    TEXT,
  confidence      NUMERIC(4,3),
  feedback_score  NUMERIC(4,3) DEFAULT 0,
  outcome_status  TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_biz ON ai_outputs(linked_business, created_date DESC);

CREATE TABLE IF NOT EXISTS feedback_events (
  id              TEXT        PRIMARY KEY,
  created_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business TEXT,
  ai_output_id    TEXT,
  agent_name      TEXT,
  module          TEXT,
  output_type     TEXT,
  rating          TEXT,
  score           INT,
  comment         TEXT,
  tags            TEXT,
  correction      TEXT,
  action_taken    TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_biz   ON feedback_events(linked_business, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_events(linked_business, agent_name);

CREATE TABLE IF NOT EXISTS business_memory (
  id                 TEXT        PRIMARY KEY,
  created_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business    TEXT        UNIQUE,
  preferred_tone     TEXT,
  preferred_channels TEXT,
  rejected_patterns  TEXT,
  accepted_patterns  TEXT,
  lead_preferences   TEXT,
  content_style      TEXT,
  agent_weights      TEXT,
  feedback_summary   TEXT,
  last_updated       TEXT,
  learning_version   INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agent_learning_profiles (
  id                 TEXT        PRIMARY KEY,
  created_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business    TEXT,
  agent_name         TEXT        NOT NULL,
  total_outputs      INT DEFAULT 0,
  positive_count     INT DEFAULT 0,
  negative_count     INT DEFAULT 0,
  accuracy_score     NUMERIC(4,3) DEFAULT 0.5,
  preference_weights TEXT,
  rejected_types     TEXT,
  accepted_types     TEXT,
  last_updated       TEXT,
  UNIQUE(linked_business, agent_name)
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id               TEXT        PRIMARY KEY,
  created_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_business  TEXT,
  signal_type      TEXT,
  agent_name       TEXT,
  pattern_key      TEXT,
  pattern_label    TEXT,
  weight           NUMERIC(5,3),
  occurrence_count INT DEFAULT 1,
  last_seen        TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_signals_biz ON learning_signals(linked_business, occurrence_count DESC);
