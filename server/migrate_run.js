const path = require('path');
const { Client } = require(path.join(__dirname, 'node_modules', '@prisma', 'client'));

// Actually use Prisma directly
const { PrismaClient } = require(path.join(__dirname, 'node_modules', '@prisma', 'client'));
require(path.join(__dirname, 'node_modules', 'dotenv')).config({ override: true, path: path.join(__dirname, '.env') });

const prisma = new PrismaClient();

const SQL = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS hyper_local_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id), event_name TEXT NOT NULL, event_type TEXT NOT NULL, venue_name TEXT, distance_meters INT NOT NULL, event_datetime TIMESTAMPTZ NOT NULL, expected_attendance INT, digital_signal_match TEXT, action_window_start TIMESTAMPTZ, action_window_end TIMESTAMPTZ, source_url TEXT NOT NULL, detected_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(), confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.8)`,
  `CREATE TABLE IF NOT EXISTS demand_forecasts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id), forecast_date DATE NOT NULL, hour_of_day INT, demand_index NUMERIC(5,2), demand_delta_pct NUMERIC(5,2), contributing_factors JSONB, weather_condition TEXT, confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.75, computed_at TIMESTAMPTZ NOT NULL DEFAULT now(), source_url TEXT NOT NULL DEFAULT 'internal://demand-forecaster')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_biz_date_hour ON demand_forecasts(business_id, forecast_date, COALESCE(hour_of_day, -1))`,
  `CREATE TABLE IF NOT EXISTS resource_arbitrage_actions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id), trigger_type TEXT NOT NULL, trigger_description TEXT NOT NULL, recommended_action TEXT NOT NULL, action_type TEXT NOT NULL, target_segment TEXT, expected_uplift_pct NUMERIC(5,2), valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL, executed BOOLEAN DEFAULT FALSE, source_url TEXT NOT NULL, detected_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(), confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.75)`,
  `CREATE TABLE IF NOT EXISTS cross_sector_signals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_sector TEXT NOT NULL, target_sector TEXT NOT NULL, trend_description TEXT NOT NULL, correlation_score NUMERIC(3,2), lag_days INT, opportunity_description TEXT, source_signal_ids UUID[], source_url TEXT NOT NULL, detected_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(), confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.75)`,
  `CREATE TABLE IF NOT EXISTS synthetic_personas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id), persona_name TEXT NOT NULL, demographic_profile JSONB NOT NULL DEFAULT '{}', behavioral_traits JSONB NOT NULL DEFAULT '{}', osint_basis TEXT[], simulated_conversion_rate NUMERIC(4,3), simulated_response JSONB, embedding_vector TEXT, computed_at TIMESTAMPTZ NOT NULL DEFAULT now(), source_url TEXT NOT NULL DEFAULT 'internal://persona-simulator')`,
  `CREATE TABLE IF NOT EXISTS meta_configurations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) UNIQUE, sector TEXT NOT NULL, auto_detected_kpis JSONB NOT NULL DEFAULT '{}', signal_keywords TEXT[] NOT NULL DEFAULT '{}', trend_thresholds JSONB NOT NULL DEFAULT '{}', competitor_search_terms TEXT[] DEFAULT '{}', local_radius_meters INT DEFAULT 500, configured_at TIMESTAMPTZ NOT NULL DEFAULT now(), configuration_version INT DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS business_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id), event_type TEXT NOT NULL, event_data JSONB NOT NULL DEFAULT '{}', occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), source TEXT DEFAULT 'system')`,
];

async function main() {
  for (const sql of SQL) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK:', sql.substring(0, 60));
    } catch(e) {
      console.error('ERR:', sql.substring(0, 60), '\n   ', e.message.substring(0, 120));
    }
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
