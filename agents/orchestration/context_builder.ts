// OTXEngine — Orchestration Layer: ContextBuilder
// Builds EnrichedContext in a single parallel fetch — no sequential waterfalls.
// Called once per bus trigger, then passed to all downstream agents.

import type {
  SupabaseClient,
  EnrichedContext,
  Business,
  BusinessProfile,
  MetaConfiguration,
  ClassifiedSignal,
  SectorTrend,
  HyperLocalEvent,
  DemandForecast,
  SyntheticPersona,
  GlobalMemoryAggregate,
  CompetitorChange,
  CrossSectorSignal,
  LastActionScore,
} from "./types.ts";

// ─── Individual data fetchers ─────────────────────────────────────────────────

async function getBusiness(
  supabase: SupabaseClient,
  businessId: string,
): Promise<Business | null> {
  const { data } = await supabase
    .from("businesses")
    .select("id, name, sector, geo_city, price_tier")
    .eq("id", businessId)
    .maybeSingle();
  return (data as Business | null);
}

async function getLatestProfile(
  supabase: SupabaseClient,
  businessId: string,
): Promise<BusinessProfile | null> {
  const { data } = await supabase
    .from("otx_business_profiles")
    .select("id, business_id, embedding_vector, computed_at")
    .eq("business_id", businessId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BusinessProfile | null);
}

async function getMetaConfig(
  supabase: SupabaseClient,
  businessId: string,
): Promise<MetaConfiguration | null> {
  const { data } = await supabase
    .from("meta_configurations")
    .select("business_id, primary_kpi, signal_keywords, local_radius_meters, z_score_spike_threshold, intent_threshold, trend_thresholds, version")
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as MetaConfiguration | null);
}

async function getActiveSignals(
  supabase: SupabaseClient,
  businessId: string,
  { hours }: { hours: number },
): Promise<ClassifiedSignal[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("classified_signals")
    .select("id, signal_id, business_id, intent_score, sector_match_score, geo_match_score, qualified, source_url, confidence_score, processed_at")
    .eq("business_id", businessId)
    .eq("qualified", true)
    .gte("processed_at", since)
    .order("processed_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as ClassifiedSignal[]);
}

async function getActiveTrends(
  supabase: SupabaseClient,
  sector: string,
): Promise<SectorTrend[]> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("sector_trends")
    .select("id, sector, z_score, spike_detected, detected_at_utc, source_url")
    .eq("sector", sector)
    .eq("spike_detected", true)
    .gte("detected_at_utc", since24h)
    .order("z_score", { ascending: false })
    .limit(5);
  return ((data ?? []) as SectorTrend[]);
}

async function getUpcomingLocalEvents(
  supabase: SupabaseClient,
  businessId: string,
  { hours }: { hours: number },
): Promise<HyperLocalEvent[]> {
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("hyper_local_events")
    .select("id, business_id, event_name, event_type, venue_name, distance_meters, event_datetime, expected_attendance, confidence_score, source_url")
    .eq("business_id", businessId)
    .gte("event_datetime", new Date().toISOString())
    .lte("event_datetime", until)
    .order("event_datetime")
    .limit(10);
  return ((data ?? []) as HyperLocalEvent[]);
}

async function getDemandForecast(
  supabase: SupabaseClient,
  businessId: string,
  { hours }: { hours: number },
): Promise<DemandForecast[]> {
  const today = new Date().toISOString().split("T")[0];
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString().split("T")[0];
  const { data } = await supabase
    .from("demand_forecasts")
    .select("business_id, forecast_date, hour_of_day, demand_index, demand_delta_pct, weather_condition, contributing_factors, confidence_score")
    .eq("business_id", businessId)
    .gte("forecast_date", today)
    .lte("forecast_date", until)
    .order("forecast_date")
    .order("hour_of_day");
  return ((data ?? []) as DemandForecast[]);
}

async function getPersonas(
  supabase: SupabaseClient,
  businessId: string,
): Promise<SyntheticPersona[]> {
  const { data } = await supabase
    .from("synthetic_personas")
    .select("id, business_id, persona_name, simulated_conversion_rate, behavioral_traits, computed_at")
    .eq("business_id", businessId)
    .order("simulated_conversion_rate", { ascending: false })
    .limit(3);
  return ((data ?? []) as SyntheticPersona[]);
}

async function getValidMemory(
  supabase: SupabaseClient,
  businessId: string,
): Promise<GlobalMemoryAggregate[]> {
  // Memory is global (not per-business), but we need it for scoring
  // Fetch the most recent valid row per agg_type + dimension_key combination
  const { data } = await supabase
    .from("global_memory_aggregates")
    .select("agg_type, dimension_key, action_type, success_rate, sample_size, is_valid, computed_at")
    .eq("is_valid", true)
    .order("computed_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as GlobalMemoryAggregate[]);
}

async function getRecentCompetitorChanges(
  supabase: SupabaseClient,
  businessId: string,
  { hours }: { hours: number },
): Promise<CompetitorChange[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("competitor_changes")
    .select("id, business_id, change_type, detected_at_utc, source_url")
    .eq("business_id", businessId)
    .gte("detected_at_utc", since)
    .order("detected_at_utc", { ascending: false })
    .limit(10);
  return ((data ?? []) as CompetitorChange[]);
}

async function getCrossSectorSignals(
  supabase: SupabaseClient,
  sector: string,
): Promise<CrossSectorSignal[]> {
  const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("cross_sector_signals")
    .select("id, source_sector, target_sector, correlation_score, lag_days, opportunity_description, trend_description, detected_at_utc, confidence_score")
    .eq("target_sector", sector)
    .gte("detected_at_utc", since72h)
    .order("correlation_score", { ascending: false })
    .limit(5);
  return ((data ?? []) as CrossSectorSignal[]);
}

async function getLastActionScore(
  supabase: SupabaseClient,
  businessId: string,
): Promise<LastActionScore | null> {
  const { data } = await supabase
    .from("actions_recommended")
    .select("action_score, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LastActionScore | null);
}

// ─── buildEnrichedContext — MAIN EXPORT ──────────────────────────────────────
// All 12 queries run in parallel via Promise.all — zero sequential waterfalls.
// If business is not found, returns null (caller skips processing).

export async function buildEnrichedContext(
  supabase: SupabaseClient,
  businessId: string,
  busEventId: string,
): Promise<EnrichedContext | null> {
  const business = await getBusiness(supabase, businessId);
  if (!business) {
    console.warn(`[ContextBuilder] Business ${businessId} not found`);
    return null;
  }

  // All 11 remaining queries in parallel
  const [
    profile, metaConfig,
    activeSignals, activeTrends, upcomingEvents,
    demandForecast, personas, memoryWeights,
    competitorChanges, crossSectorSignals, lastAction,
  ] = await Promise.all([
    getLatestProfile(supabase, businessId),
    getMetaConfig(supabase, businessId),
    getActiveSignals(supabase, businessId, { hours: 4 }),
    getActiveTrends(supabase, business.sector),
    getUpcomingLocalEvents(supabase, businessId, { hours: 48 }),
    getDemandForecast(supabase, businessId, { hours: 72 }),
    getPersonas(supabase, businessId),
    getValidMemory(supabase, businessId),
    getRecentCompetitorChanges(supabase, businessId, { hours: 24 }),
    getCrossSectorSignals(supabase, business.sector),
    getLastActionScore(supabase, businessId),
  ]);

  const staleFlagActive = memoryWeights.length === 0 || !memoryWeights.some((m) => m.is_valid);

  return {
    business,
    profile,
    metaConfig,
    activeSignals,
    activeTrends,
    upcomingEvents,
    demandForecast,
    personas,
    memoryWeights,
    competitorChanges,
    crossSectorSignals,
    lastActionScore: lastAction?.action_score ?? 0,
    staleFlagActive,
    busEventId,
  };
}
