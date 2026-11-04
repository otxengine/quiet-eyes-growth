-- ============================================================
-- OTXEngine — Phase 1.3: Row-Level Security
-- global_memory_aggregates and events_raw are shared — no RLS
-- ============================================================

ALTER TABLE businesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE otx_business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals_raw           ENABLE ROW LEVEL SECURITY;
ALTER TABLE classified_signals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_trends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_changes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions_recommended   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_heartbeat       ENABLE ROW LEVEL SECURITY;

-- businesses: users see only their own row
CREATE POLICY tenant_isolation_businesses ON businesses
  USING (id = auth.uid()::uuid);

-- otx_business_profiles: scoped by business_id
CREATE POLICY tenant_isolation_otx_business_profiles ON otx_business_profiles
  USING (business_id = auth.uid()::uuid);

-- signals_raw: scoped by business_id
CREATE POLICY tenant_isolation_signals_raw ON signals_raw
  USING (business_id = auth.uid()::uuid);

-- classified_signals: scoped by business_id
CREATE POLICY tenant_isolation_classified_signals ON classified_signals
  USING (business_id = auth.uid()::uuid);

-- sector_trends: every authenticated user can read all sector trends
-- (sector-level data is not PII; used cross-tenant for pattern detection)
CREATE POLICY read_all_sector_trends ON sector_trends
  FOR SELECT USING (auth.role() = 'authenticated');

-- event_opportunities: scoped by business_id
CREATE POLICY tenant_isolation_event_opportunities ON event_opportunities
  USING (business_id = auth.uid()::uuid);

-- competitor_changes: scoped by business_id
CREATE POLICY tenant_isolation_competitor_changes ON competitor_changes
  USING (business_id = auth.uid()::uuid);

-- actions_recommended: scoped by business_id
CREATE POLICY tenant_isolation_actions ON actions_recommended
  USING (business_id = auth.uid()::uuid);

-- agent_heartbeat: system agents write via service_role; authenticated users can read
CREATE POLICY read_heartbeat ON agent_heartbeat
  FOR SELECT USING (auth.role() = 'authenticated');
