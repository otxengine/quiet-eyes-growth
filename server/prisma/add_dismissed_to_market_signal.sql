ALTER TABLE "market_signals" ADD COLUMN IF NOT EXISTS "is_dismissed" BOOLEAN DEFAULT false;
