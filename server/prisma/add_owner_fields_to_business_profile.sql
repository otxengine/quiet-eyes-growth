ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "owner_name" TEXT,
  ADD COLUMN IF NOT EXISTS "phone"      TEXT;
