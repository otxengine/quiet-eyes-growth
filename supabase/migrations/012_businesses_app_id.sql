-- OTXEngine — Migration 012: link Supabase businesses rows back to the
-- Prisma BusinessProfile that owns them.
--
-- BusinessProfile.id (server/prisma/schema.prisma) is a cuid string, not a
-- UUID, so it can't be reused as businesses.id (UUID PRIMARY KEY). Instead,
-- a unique text column lets application code upsert idempotently via
-- onConflict: 'app_business_id' while Supabase keeps generating its own id.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS app_business_id TEXT UNIQUE;
