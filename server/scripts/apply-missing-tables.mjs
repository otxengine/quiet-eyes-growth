// apply-missing-tables.mjs — creates all tables that are missing from production DB.
// Run with: node scripts/apply-missing-tables.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function sql(query, label) {
  try {
    await prisma.$executeRawUnsafe(query);
    console.log(' ✓', label);
  } catch (e) {
    console.warn(' ✗', label, '—', e.message.split('\n')[0]);
  }
}

async function main() {
  console.log('\n=== Applying missing tables to production DB ===\n');

  // ── agent_heartbeat ────────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS agent_heartbeat (
    id                 SERIAL PRIMARY KEY,
    agent_name         TEXT NOT NULL,
    last_ping_utc      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_ingestion_utc TIMESTAMPTZ,
    status             TEXT NOT NULL DEFAULT 'ok',
    error_message      TEXT
  )`, 'agent_heartbeat table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_name ON agent_heartbeat(agent_name, last_ping_utc DESC)`, 'agent_heartbeat index');

  // ── agent_data_bus ─────────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS agent_data_bus (
    id           SERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    payload      JSONB,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`, 'agent_data_bus table');

  // ── otx_decisions ──────────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_decisions (
    id                       TEXT PRIMARY KEY,
    business_id              TEXT NOT NULL,
    decision_type            TEXT NOT NULL,
    title                    TEXT NOT NULL,
    reasoning                TEXT,
    confidence_score         NUMERIC(5,3),
    business_fit_score       NUMERIC(5,3),
    timing_fit_score         NUMERIC(5,3),
    historical_success_score NUMERIC(5,3),
    roi_score                NUMERIC(5,3),
    status                   TEXT NOT NULL DEFAULT 'pending',
    insight_id               TEXT,
    trace_id                 TEXT,
    action_type              TEXT,
    urgency                  TEXT,
    rationale                TEXT,
    final_score              NUMERIC(5,3),
    execution_mode           TEXT DEFAULT 'suggest',
    fused_insight_id         TEXT,
    approval_required        BOOLEAN DEFAULT false,
    policy_version           INT DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`, 'otx_decisions table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_decisions_biz ON otx_decisions(business_id, created_at DESC)`, 'otx_decisions index');

  // ── otx_competitor_snapshots ───────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_competitor_snapshots (
    id            TEXT PRIMARY KEY DEFAULT md5(random()::text),
    competitor_id TEXT NOT NULL,
    business_id   TEXT NOT NULL,
    snapshot_json JSONB NOT NULL,
    taken_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`, 'otx_competitor_snapshots table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_comp_snapshots ON otx_competitor_snapshots(competitor_id, taken_at DESC)`, 'otx_competitor_snapshots index');

  // ── meta_configurations ────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS meta_configurations (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    business_id             TEXT NOT NULL UNIQUE,
    sector                  TEXT NOT NULL DEFAULT '',
    auto_detected_kpis      JSONB NOT NULL DEFAULT '{}',
    signal_keywords         TEXT[] NOT NULL DEFAULT '{}',
    trend_thresholds        JSONB NOT NULL DEFAULT '{}',
    competitor_search_terms TEXT[] DEFAULT '{}',
    local_radius_meters     INT DEFAULT 500,
    configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    configuration_version   INT DEFAULT 1
  )`, 'meta_configurations table');

  // ── otx_opportunities ──────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_opportunities (
    id                    TEXT PRIMARY KEY,
    business_id           TEXT NOT NULL,
    type                  TEXT NOT NULL,
    source_signal_ids     JSONB NOT NULL DEFAULT '[]',
    source_event_ids      JSONB NOT NULL DEFAULT '[]',
    source_forecast_ids   JSONB NOT NULL DEFAULT '[]',
    opportunity_score     NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    urgency               TEXT NOT NULL DEFAULT 'medium',
    confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    expected_window_start TIMESTAMPTZ,
    expected_window_end   TIMESTAMPTZ,
    explanation           TEXT NOT NULL DEFAULT '',
    dedup_key             TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, dedup_key)
  )`, 'otx_opportunities table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_opps_biz_status ON otx_opportunities(business_id, status, created_at DESC)`, 'otx_opportunities index');

  // ── otx_threats ────────────────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_threats (
    id           TEXT PRIMARY KEY,
    business_id  TEXT NOT NULL,
    type         TEXT NOT NULL,
    risk_score   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    urgency      TEXT NOT NULL DEFAULT 'medium',
    confidence   NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    explanation  TEXT NOT NULL DEFAULT '',
    signal_ids   JSONB NOT NULL DEFAULT '[]',
    dedup_key    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(business_id, dedup_key)
  )`, 'otx_threats table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_threats_biz_status ON otx_threats(business_id, status, created_at DESC)`, 'otx_threats index');

  // ── otx_weight_update_log ─────────────────────────────────────────────────
  await sql(`CREATE TABLE IF NOT EXISTS otx_weight_update_log (
    id           TEXT PRIMARY KEY,
    business_id  TEXT NOT NULL,
    agent_name   TEXT NOT NULL,
    action_type  TEXT NOT NULL,
    old_weight   NUMERIC(5,4) NOT NULL,
    new_weight   NUMERIC(5,4) NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_id   TEXT,
    delta        NUMERIC(6,4) NOT NULL,
    reason       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(id)
  )`, 'otx_weight_update_log table');
  await sql(`CREATE INDEX IF NOT EXISTS idx_otx_wlog_biz_agent ON otx_weight_update_log(business_id, agent_name, created_at DESC)`, 'otx_weight_update_log index');

  // ── OTX columns that may be missing on older tables ───────────────────────
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS action_type TEXT`, 'otx_decisions.action_type');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS urgency TEXT`, 'otx_decisions.urgency');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS rationale TEXT`, 'otx_decisions.rationale');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS final_score NUMERIC(5,3)`, 'otx_decisions.final_score');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'suggest'`, 'otx_decisions.execution_mode');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS fused_insight_id TEXT`, 'otx_decisions.fused_insight_id');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false`, 'otx_decisions.approval_required');
  await sql(`ALTER TABLE otx_decisions ADD COLUMN IF NOT EXISTS policy_version INT DEFAULT 1`, 'otx_decisions.policy_version');

  // ── business_profiles extra columns ───────────────────────────────────────
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS subscription_plan TEXT`, 'business_profiles.subscription_plan');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS search_radius_km INT DEFAULT 15`, 'business_profiles.search_radius_km');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS additional_cities TEXT`, 'business_profiles.additional_cities');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS branches TEXT`, 'business_profiles.branches');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_intent_signals TEXT`, 'business_profiles.lead_intent_signals');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS lead_quality_notes TEXT`, 'business_profiles.lead_quality_notes');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS autonomy_level TEXT DEFAULT 'semi_auto'`, 'business_profiles.autonomy_level');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`, 'business_profiles.onboarding_completed');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS website_url TEXT`, 'business_profiles.website_url');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS facebook_url TEXT`, 'business_profiles.facebook_url');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS instagram_url TEXT`, 'business_profiles.instagram_url');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS tiktok_url TEXT`, 'business_profiles.tiktok_url');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_place_id TEXT`, 'business_profiles.google_place_id');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS google_maps_url TEXT`, 'business_profiles.google_maps_url');
  await sql(`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS phone TEXT`, 'business_profiles.phone');

  // ── other columns referenced in agents ────────────────────────────────────
  await sql(`ALTER TABLE market_signals ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`, 'market_signals.dismiss_reason');
  await sql(`ALTER TABLE proactive_alerts ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`, 'proactive_alerts.dismiss_reason');
  await sql(`ALTER TABLE proactive_alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`, 'proactive_alerts.created_at');
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS not_relevant BOOLEAN DEFAULT false`, 'competitors.not_relevant');
  await sql(`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS not_relevant_reason TEXT`, 'competitors.not_relevant_reason');
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS platform_sourced BOOLEAN DEFAULT false`, 'leads.platform_sourced');
  await sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value NUMERIC`, 'leads.deal_value');

  console.log('\n=== Running final verification ===\n');

  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const existing = new Set(tables.map(r => r.table_name));

  const required = [
    'agent_heartbeat', 'agent_data_bus', 'otx_decisions', 'otx_competitor_snapshots',
    'meta_configurations', 'otx_opportunities', 'otx_threats', 'otx_weight_update_log',
    'auto_actions', 'system_events', 'routing_rules', 'composite_signals', 'business_constraints',
    'business_profiles', 'leads', 'reviews', 'competitors', 'proactive_alerts',
    'raw_signals', 'market_signals', 'automation_logs', 'sector_knowledge', 'business_memory',
    'predictions', 'health_scores', 'actions', 'tasks', 'learning_signals', 'outcome_logs',
    'media_assets', 'organic_posts', 'campaigns',
  ];

  let allGood = true;
  for (const t of required) {
    if (!existing.has(t)) { console.log(' ✗ STILL MISSING:', t); allGood = false; }
  }
  if (allGood) console.log(' ✓ All required tables now exist!\n');
}

main()
  .catch(e => { console.error('\nFATAL:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
