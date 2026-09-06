ALTER TABLE "competitor_ad_history" ADD COLUMN IF NOT EXISTS "cloned_from_donor" BOOLEAN DEFAULT false;
