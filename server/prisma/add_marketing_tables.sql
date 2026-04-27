-- MediaAsset
CREATE TABLE IF NOT EXISTS "media_assets" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "created_date"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linked_business" TEXT,
  "image_base64"    TEXT,
  "mime_type"       TEXT DEFAULT 'image/jpeg',
  "source"          TEXT DEFAULT 'uploaded',
  "description"     TEXT,
  "used_in"         TEXT
);

-- OrganicPost
CREATE TABLE IF NOT EXISTS "organic_posts" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "created_date"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linked_business" TEXT,
  "signal_id"       TEXT,
  "signal_summary"  TEXT,
  "platform"        TEXT,
  "post_type"       TEXT NOT NULL DEFAULT 'post',
  "content"         TEXT,
  "media_asset_id"  TEXT,
  "image_url"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "published_at"    TIMESTAMP(3)
);

-- services_json on business profiles
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "services_json" TEXT;
