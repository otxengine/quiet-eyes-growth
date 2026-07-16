-- KAN-120: enforce dedup on google_review_id at the DB level
-- Partial index: NULLs (Tavily reviews) are excluded, so multiple NULL rows are allowed
-- Scoped per business so two businesses can't collide on synthetic Places IDs
CREATE UNIQUE INDEX IF NOT EXISTS reviews_google_review_id_unique
  ON reviews (linked_business, google_review_id)
  WHERE google_review_id IS NOT NULL;
