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

  UNIQUE (competitor_id, external_story_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_stories_business_competitor_posted
  ON competitor_stories (linked_business, competitor_id, posted_at);
