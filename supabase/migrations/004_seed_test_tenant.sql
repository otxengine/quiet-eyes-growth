-- ============================================================
-- OTXEngine — Phase 1.4: Seed test tenant
-- ============================================================

INSERT INTO businesses (id, name, sector, geo_city, price_tier)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Mega Sport',
  'fitness',
  'bnei_brak',
  'mid'
)
ON CONFLICT (id) DO NOTHING;
