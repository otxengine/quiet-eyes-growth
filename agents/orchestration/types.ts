// OTXEngine — Orchestration Layer: Shared Types
// Imported by bus_publisher, bus_consumer, context_builder, insight_fusion

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type { SupabaseClient };

// ─── Event types (must match agent_data_bus CHECK constraint) ─────────────────

export type BusEventType =
  // Layer 1–6 (existing)
  | "new_signal"
  | "signal_qualified"
  | "trend_spike"
  | "local_event_detected"
  | "demand_gap_forecast"
  | "competitor_change"
  | "persona_updated"
  | "cross_sector_opportunity"
  | "arbitrage_action_ready"
  | "action_scored"
  | "memory_updated"
  | "config_updated"
  // Layer 7 — new
  | "viral_pattern_detected"
  | "trend_verified"
  | "trend_manipulated"
  | "visual_insight_detected"
  | "churn_risk_detected"
  | "pricing_recommendation_ready"
  | "campaign_draft_ready"
  | "expansion_opportunity_detected"
  | "reputation_incident_detected";

// ─── Bus event written by a publishing agent ──────────────────────────────────

export interface BusEvent {
  business_id:      string;
  sourceAgent:      string;
  sourceRecordId:   string;
  sourceTable:      string;
  event_type:       BusEventType;
  payload:          Record<string, unknown>;
}

// ─── Row as read from agent_data_bus ─────────────────────────────────────────

export interface BusRow {
  id:               string;
  business_id:      string;
  source_agent:     string;
  source_record_id: string;
  source_table:     string;
  event_type:       BusEventType;
  payload:          Record<string, unknown>;
  priority:         number;
  target_agents:    string[];
  consumed_by:      string[];
  created_at:       string;
  expires_at:       string;
  processed:        boolean;
}

// ─── Agent route in EVENT_ROUTING ─────────────────────────────────────────────

export interface AgentRoute {
  agent:     string;
  priority:  number;
  condition: string;    // expression evaluated by evaluateCondition()
}

// ─── Handler invoked by consumeFromBus ───────────────────────────────────────

export type BusEventHandler = (
  payload:    Record<string, unknown>,
  businessId: string,
  busEventId: string,
) => Promise<void>;

// ─── EnrichedContext — full business state, built once per trigger ────────────

export interface Business {
  id:         string;
  name:       string;
  sector:     "restaurant" | "fitness" | "beauty" | "local";
  geo_city:   string;
  price_tier: "budget" | "mid" | "premium" | null;
}

export interface BusinessProfile {
  id:               string;
  business_id:      string;
  embedding_vector: number[] | null;
  computed_at:      string;
}

export interface MetaConfiguration {
  business_id:              string;
  primary_kpi:              string;
  signal_keywords:          string[];
  local_radius_meters:      number;
  z_score_spike_threshold:  number;
  intent_threshold:         number;
  trend_thresholds:         Record<string, number>;
  version:                  number;
}

export interface ClassifiedSignal {
  id:                 string;
  signal_id:          string;
  business_id:        string;
  intent_score:       number;
  sector_match_score: number;
  geo_match_score:    number;
  qualified:          boolean;
  source_url:         string;
  confidence_score:   number;
  processed_at:       string;
}

export interface SectorTrend {
  id:              string;
  sector:          string;
  z_score:         number;
  spike_detected:  boolean;
  detected_at_utc: string;
  source_url:      string;
}

export interface HyperLocalEvent {
  id:                  string;
  business_id:         string;
  event_name:          string;
  event_type:          string;
  venue_name:          string | null;
  distance_meters:     number;
  event_datetime:      string;
  expected_attendance: number | null;
  confidence_score:    number;
  source_url:          string;
}

export interface DemandForecast {
  business_id:          string;
  forecast_date:        string;
  hour_of_day:          number;
  demand_index:         number;
  demand_delta_pct:     number;
  weather_condition:    string;
  contributing_factors: Record<string, number>;
  confidence_score:     number;
}

export interface SyntheticPersona {
  id:                        string;
  business_id:               string;
  persona_name:              string;
  simulated_conversion_rate: number;
  behavioral_traits:         Record<string, unknown>;
  computed_at:               string;
}

export interface GlobalMemoryAggregate {
  agg_type:      string;
  dimension_key: string;
  action_type:   string;
  success_rate:  number;
  sample_size:   number;
  is_valid:      boolean;
  computed_at:   string;
}

export interface CompetitorChange {
  id:              string;
  business_id:     string;
  change_type:     string;
  detected_at_utc: string;
  source_url:      string;
}

export interface CrossSectorSignal {
  id:                      string;
  source_sector:           string;
  target_sector:           string;
  correlation_score:       number;
  lag_days:                number;
  opportunity_description: string;
  trend_description:       string;
  detected_at_utc:         string;
  confidence_score:        number;
}

export interface LastActionScore {
  action_score: number;
  created_at:   string;
}

export interface EnrichedContext {
  business:             Business;
  profile:              BusinessProfile | null;
  metaConfig:           MetaConfiguration | null;

  // Real-time state
  activeSignals:        ClassifiedSignal[];
  activeTrends:         SectorTrend[];
  upcomingEvents:       HyperLocalEvent[];
  demandForecast:       DemandForecast[];

  // Intelligence state
  personas:             SyntheticPersona[];
  memoryWeights:        GlobalMemoryAggregate[];
  competitorChanges:    CompetitorChange[];
  crossSectorSignals:   CrossSectorSignal[];

  // Meta
  lastActionScore:      number;
  staleFlagActive:      boolean;
  busEventId:           string;
}

// ─── FusedInsight — output of InsightFusionEngine ────────────────────────────

export interface InsightSignal {
  type:   string;
  weight: number;
  data:   Record<string, unknown>;
}

export interface FusedInsight {
  headline:             string;
  urgency:              "high" | "medium" | "low";
  one_sentence:         string;
  impact_number:        string;
  action_label:         string;
  action_time_minutes:  number;
  source_agents:        string[];
  contributing_signals: InsightSignal[];
  computed_at:          string;
}

// ─── Layer 7 interfaces ───────────────────────────────────────────────────────

export interface ViralPattern {
  id:              string;
  business_id:     string;
  pattern_type:    "format" | "music" | "hashtag" | "timing" | "hook";
  pattern_value:   string;
  platform:        "tiktok" | "instagram" | "facebook" | "youtube";
  virality_score:  number;
  geo_relevance:   string | null;
  peak_hour:       number | null;
  script_template: string | null;
  source_url:      string;
  detected_at_utc: string;
}

export interface InfluenceIntegrityScore {
  id:                   string;
  business_id:          string;
  trend_id:             string | null;
  organic_pct:          number;
  bot_pct:              number;
  coordinated_pct:      number;
  verdict:              "organic" | "suspicious" | "manipulated";
  graph_density:        number | null;
  account_age_avg_days: number | null;
  recommendation:       string | null;
  source_url:           string;
}

export interface VisualOsintSignal {
  id:                    string;
  business_id:           string;
  media_url:             string;
  platform:              string;
  detected_objects:      string[] | null;
  scene_tags:            string[] | null;
  business_insight:      string | null;
  unmet_demand_detected: boolean;
  sentiment_visual:      "positive" | "neutral" | "negative" | "urgent" | null;
  geo:                   string | null;
  source_url:            string;
}

export interface RetentionAlert {
  id:                    string;
  business_id:           string;
  customer_identifier:   string;
  risk_level:            "low" | "medium" | "high" | "critical";
  churn_probability:     number;
  last_interaction_days: number | null;
  external_signal:       string | null;
  external_signal_url:   string | null;
  recommended_offer:     string | null;
  offer_sent:            boolean;
}

export interface PricingRecommendation {
  id:                         string;
  business_id:                string;
  lead_context:               string | null;
  market_supply:              "scarce" | "balanced" | "flooded" | null;
  competitor_avg_price:       number | null;
  recommended_price_modifier: number;
  recommended_tactic:         "premium" | "standard" | "discount" | "bundle";
  tactic_reason:              string | null;
  confidence_pct:             number;
  valid_until:                string | null;
}

export interface CampaignDraft {
  id:               string;
  business_id:      string;
  trigger_event:    string;
  platform:         string;
  headline:         string;
  body_text:        string;
  cta_text:         string;
  target_audience:  Record<string, unknown> | null;
  estimated_reach:  number | null;
  auto_publish:     boolean;
  status:           "draft" | "approved" | "published" | "rejected";
}

export interface ExpansionOpportunity {
  id:                       string;
  business_id:              string;
  opportunity_title:        string;
  unmet_demand_description: string;
  demand_signal_count:      number;
  geo:                      string | null;
  estimated_monthly_revenue: number | null;
  estimated_investment:     number | null;
  roi_months:               number | null;
  lead_examples:            string[] | null;
  confidence_score:         number;
}

export interface ReputationIncident {
  id:                   string;
  business_id:          string;
  severity:             "low" | "medium" | "high" | "critical";
  incident_type:        "negative_review_spike" | "viral_complaint" | "competitor_attack" | "fake_reviews" | "media_mention" | null;
  description:          string;
  affected_platforms:   string[] | null;
  recommended_response: string | null;
  response_deadline:    string | null;
  resolved:             boolean;
  source_url:           string;
}

// AccountMetrics used by InfluenceIntegrityAuditor
export interface AccountMetrics {
  avg_account_age_days:       number;
  avg_followers:              number;
  inter_connection_density:   number;
  post_timing_variance_minutes: number;
  unique_ip_diversity:        number;
}

// CustomerProfile used by RetentionSentinel
export interface CustomerProfile {
  hashedId:              string;
  identifier:            string;
  last_interaction_days: number;
  visit_frequency_trend: "stable" | "declining" | "growing";
  wrote_negative_review: boolean;
}

// ExternalSignal used by RetentionSentinel
export interface ExternalSignal {
  text:                string;
  url:                 string;
  mentions_competitor: boolean;
  seeking_alternatives: boolean;
}

// MediaItem used by DeepContextVisionAgent
export interface MediaItem {
  url:        string;
  platform:   string;
  source_url: string;
}

// DemandCluster used by ServiceExpansionScout
export interface DemandCluster {
  topic:        string;
  signal_count: number;
  examples:     string[];
  signal_ids:   string[];
  source_urls:  string[];
}
