CREATE TABLE IF NOT EXISTS competitor_posts (
  id               TEXT PRIMARY KEY,
  competitor_id    TEXT NOT NULL,
  platform         TEXT NOT NULL,
  external_post_id TEXT,
  post_url         TEXT,
  caption          TEXT,
  media_url        TEXT,
  posted_at        TEXT,
  likes            INTEGER,
  comments         INTEGER,
  last_seen_at     TEXT NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_posts_competitor_platform
  ON competitor_posts (competitor_id, platform);
