-- ============================================================
-- OTXEngine — Phase 1.6: Seed competitor configs
-- Adds competitor:: keyword entries to otx_business_profiles
-- so CompetitorSnapshot agent has targets to monitor.
-- ============================================================

-- Ensure the sushi restaurant business exists
INSERT INTO businesses (id, name, sector, geo_city, price_tier)
VALUES (
  'b2c3d4e5-0000-0000-0000-000000000002',
  'אומה סושי בר',
  'restaurant',
  'zichron_yaakov',
  'mid'
)
ON CONFLICT (id) DO NOTHING;

-- Seed competitor configs for Mega Sport (fitness sector)
-- Format: "competitor::{name}::{website_url}" or "competitor::{name}::{website_url}::{google_place_id}"
INSERT INTO otx_business_profiles (business_id, keywords, updated_at)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  ARRAY[
    'כושר',
    'ספורט',
    'ציוד ספורט',
    'אימון',
    'תזונה',
    'competitor::Sport Depot::https://www.sportdepot.co.il',
    'competitor::Decathlon IL::https://www.decathlon.co.il',
    'competitor::Fox Active::https://www.foxactive.co.il'
  ],
  NOW()
)
ON CONFLICT (business_id) DO UPDATE
  SET keywords = ARRAY[
    'כושר',
    'ספורט',
    'ציוד ספורט',
    'אימון',
    'תזונה',
    'competitor::Sport Depot::https://www.sportdepot.co.il',
    'competitor::Decathlon IL::https://www.decathlon.co.il',
    'competitor::Fox Active::https://www.foxactive.co.il'
  ],
  updated_at = NOW();

-- Seed competitor configs for אומה סושי בר (restaurant sector)
INSERT INTO otx_business_profiles (business_id, keywords, updated_at)
VALUES (
  'b2c3d4e5-0000-0000-0000-000000000002',
  ARRAY[
    'סושי',
    'מסעדה',
    'יפנית',
    'דגים',
    'רולים',
    'אסיאתי',
    'ארוחת ערב',
    'זכרון יעקב',
    'competitor::סושי בר זכרון::https://www.zichron.co.il/sushi',
    'competitor::נאמי סושי::https://www.nami-sushi.co.il',
    'competitor::טאיפאן::https://www.taypan.co.il'
  ],
  NOW()
)
ON CONFLICT (business_id) DO UPDATE
  SET keywords = ARRAY[
    'סושי',
    'מסעדה',
    'יפנית',
    'דגים',
    'רולים',
    'אסיאתי',
    'ארוחת ערב',
    'זכרון יעקב',
    'competitor::סושי בר זכרון::https://www.zichron.co.il/sushi',
    'competitor::נאמי סושי::https://www.nami-sushi.co.il',
    'competitor::טאיפאן::https://www.taypan.co.il'
  ],
  updated_at = NOW();
