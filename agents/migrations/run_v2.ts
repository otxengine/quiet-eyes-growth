/**
 * OTXEngine v2 Migration Runner — Deno
 * Creates the 6 missing tables via Supabase JS client (uses REST API, not direct PG)
 *
 * Run: deno run --allow-net --allow-env --allow-read agents/migrations/run_v2.ts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://mvywtnjptbpxvmoldrxe.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12eXd0bmpwdGJweHZtb2xkcnhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQwNDQzNCwiZXhwIjoyMDg2OTgwNDM0fQ.Ajc4YSEEKabgVDj8KDO69kPmGHUwYfjeOd-99Ftpots";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SQL statements to execute ────────────────────────────────────────────────

const SQL_STATEMENTS = [
  // hyper_local_events
  `CREATE TABLE IF NOT EXISTS hyper_local_events (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID        NOT NULL REFERENCES businesses(id),
    event_name           TEXT        NOT NULL,
    event_type           TEXT        NOT NULL,
    venue_name           TEXT,
    distance_meters      INT         NOT NULL DEFAULT 0,
    event_datetime       TIMESTAMPTZ NOT NULL,
    expected_attendance  INT,
    digital_signal_match TEXT,
    action_window_start  TIMESTAMPTZ,
    action_window_end    TIMESTAMPTZ,
    source_url           TEXT        NOT NULL DEFAULT '',
    detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.80
  )`,

  // demand_forecasts
  `CREATE TABLE IF NOT EXISTS demand_forecasts (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID        NOT NULL REFERENCES businesses(id),
    forecast_date         DATE        NOT NULL,
    hour_of_day           INT,
    demand_index          NUMERIC(5,2),
    demand_delta_pct      NUMERIC(5,2),
    contributing_factors  JSONB,
    weather_condition     TEXT,
    confidence_score      NUMERIC(3,2) NOT NULL DEFAULT 0.75,
    computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url            TEXT        NOT NULL DEFAULT 'internal://demand-forecaster'
  )`,

  // resource_arbitrage_actions
  `CREATE TABLE IF NOT EXISTS resource_arbitrage_actions (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID        NOT NULL REFERENCES businesses(id),
    trigger_type         TEXT        NOT NULL DEFAULT 'low_demand',
    trigger_description  TEXT        NOT NULL DEFAULT '',
    recommended_action   TEXT        NOT NULL DEFAULT '',
    action_type          TEXT        NOT NULL DEFAULT 'promotion',
    target_segment       TEXT,
    expected_uplift_pct  NUMERIC(5,2),
    valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until          TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
    executed             BOOLEAN     DEFAULT FALSE,
    source_url           TEXT        NOT NULL DEFAULT 'internal://resource-arbitrage',
    detected_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confidence_score     NUMERIC(3,2) NOT NULL DEFAULT 0.75
  )`,

  // cross_sector_signals
  `CREATE TABLE IF NOT EXISTS cross_sector_signals (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_sector           TEXT        NOT NULL,
    target_sector           TEXT        NOT NULL,
    trend_description       TEXT        NOT NULL DEFAULT '',
    correlation_score       NUMERIC(3,2),
    lag_days                INT,
    opportunity_description TEXT,
    source_signal_ids       UUID[],
    source_url              TEXT        NOT NULL DEFAULT 'internal://cross-sector',
    detected_at_utc         TIMESTAMPTZ NOT NULL DEFAULT now(),
    confidence_score        NUMERIC(3,2) NOT NULL DEFAULT 0.75
  )`,

  // synthetic_personas (embedding_vector as TEXT to avoid pgvector requirement)
  `CREATE TABLE IF NOT EXISTS synthetic_personas (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id               UUID        NOT NULL REFERENCES businesses(id),
    persona_name              TEXT        NOT NULL,
    demographic_profile       JSONB       NOT NULL DEFAULT '{}',
    behavioral_traits         JSONB       NOT NULL DEFAULT '{}',
    osint_basis               TEXT[],
    simulated_conversion_rate NUMERIC(4,3),
    simulated_response        JSONB,
    embedding_vector          TEXT,
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url                TEXT        NOT NULL DEFAULT 'internal://persona-simulator'
  )`,

  // meta_configurations
  `CREATE TABLE IF NOT EXISTS meta_configurations (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             UUID    NOT NULL REFERENCES businesses(id) UNIQUE,
    sector                  TEXT    NOT NULL DEFAULT '',
    auto_detected_kpis      JSONB   NOT NULL DEFAULT '{}',
    signal_keywords         TEXT[]  NOT NULL DEFAULT '{}',
    trend_thresholds        JSONB   NOT NULL DEFAULT '{}',
    competitor_search_terms TEXT[]  DEFAULT '{}',
    local_radius_meters     INT     DEFAULT 500,
    configured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    configuration_version   INT     DEFAULT 1
  )`,

  // business_events
  `CREATE TABLE IF NOT EXISTS business_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID        NOT NULL REFERENCES businesses(id),
    event_type  TEXT        NOT NULL,
    event_data  JSONB       NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source      TEXT        DEFAULT 'system'
  )`,
];

// ── Use Supabase REST to create a helper function, then call it ──────────────
// Since we can't run DDL via REST directly, we use the pg.run RPC workaround:
// Insert into a temp table that triggers the DDL via a trigger.
//
// ACTUAL approach: use the Supabase management REST API with service role
// The Supabase pgSQL endpoint accepts raw SQL via /rest/v1/rpc/

// ── Alternative: use Deno's built-in PostgreSQL driver ──────────────────────
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const DB_URL = "postgresql://postgres:sTBQ92DfuGzvCLaD@db.mvywtnjptbpxvmoldrxe.supabase.co:5432/postgres";

async function runMigration() {
  console.log("🔄 OTXEngine v2 Migration — connecting to Supabase...");

  const client = new Client(DB_URL);

  try {
    await client.connect();
    console.log("✅ Connected to database");

    for (const sql of SQL_STATEMENTS) {
      const label = sql.trim().split("\n")[0].substring(0, 60);
      try {
        await client.queryArray(sql);
        console.log(`✅ ${label}`);
      } catch (err: any) {
        if (err.message?.includes("already exists")) {
          console.log(`⏭  SKIP (exists): ${label}`);
        } else {
          console.error(`❌ FAIL: ${label}\n   ${err.message}`);
        }
      }
    }

    // Verify all tables exist
    const { rows } = await client.queryArray(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('hyper_local_events','demand_forecasts','resource_arbitrage_actions',
                           'cross_sector_signals','synthetic_personas','meta_configurations','business_events')
      ORDER BY table_name
    `);
    console.log(`\n📊 Tables verified: ${rows.length}/7`);
    for (const [name] of rows) console.log(`   ✅ ${name}`);

  } finally {
    await client.end();
    console.log("\n✅ Migration complete!");
  }
}

runMigration().catch((err) => {
  console.error("Migration failed:", err.message);
  Deno.exit(1);
});
