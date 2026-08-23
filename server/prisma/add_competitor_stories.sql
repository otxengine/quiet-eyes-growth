CREATE TABLE IF NOT EXISTS competitor_stories (
  id                 TEXT PRIMARY KEY,
  linked_business    TEXT,
  competitor_id      TEXT NOT NULL,
  platform           TEXT NOT NULL DEFAULT 'instagram',
  external_story_id  TEXT NOT NULL,
  media_url          TEXT,
  media_type         TEXT,
  posted_at          TIMESTAMP WITH TIME ZONE,
  expires_at         TIMESTAMP WITH TIME ZONE,
  first_seen_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  analysis           TEXT,
  analyzed_at        TIMESTAMP WITH TIME ZONE,
  has_offer          BOOLEAN,
  has_cta            BOOLEAN,

  UNIQUE (competitor_id, external_story_id)
);

-- Safe to re-run on an already-created table (e.g. adding AI analysis columns later).
ALTER TABLE competitor_stories ADD COLUMN IF NOT EXISTS analysis TEXT;
ALTER TABLE competitor_stories ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE competitor_stories ADD COLUMN IF NOT EXISTS has_offer BOOLEAN;
ALTER TABLE competitor_stories ADD COLUMN IF NOT EXISTS has_cta BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_competitor_stories_business_competitor_posted
  ON competitor_stories (linked_business, competitor_id, posted_at);
