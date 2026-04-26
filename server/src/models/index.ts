/**
 * OTXEngine Core Domain Models — v3
 *
 * Single source of truth for all domain types.
 * No Prisma dependencies — pure TypeScript.
 * Every entity is traceable: signal → opportunity/threat → insight → decision → recommendation → execution → outcome
 */

// ─── Ingestion Layer ──────────────────────────────────────────────────────────

/** Normalized ingested signal with dedup hash */
export interface Signal {
  id:               string;
  source:           'web' | 'social' | 'review' | 'market' | 'osint' | 'competitor';
  business_scope:   string;           // businessProfileId or 'global'
  sector:           string;
  location:         string | null;
  raw_payload:      Record<string, unknown>;
  normalized_text:  string;
  collected_at:     string;           // ISO 8601
  hash:             string;           // sha256 of (normalized_text + source + business_scope)
}

/** Legacy alias — kept for compatibility with existing routes */
export interface RawSignalNormalized {
  id:               string;
  source:           'web' | 'social' | 'review' | 'market' | 'osint';
  business_id:      string;
  raw_text:         string;
  detected_location?: string;
  url?:             string;
  relevance_hint?:  number;
  created_at:       string;
}

export interface CompetitorChange {
  id:              string;
  competitor_id:   string;
  business_id:     string;
  change_type:     'rating' | 'price' | 'service' | 'promotion' | 'new_competitor';
  previous_value:  string | null;
  new_value:       string;
  detected_at:     string;
  severity:        'low' | 'medium' | 'high';
}

// ─── Intelligence Layer ───────────────────────────────────────────────────────

/** Signal scored by classification pipeline */
export interface ClassifiedSignal {
  id:                 string;
  signal_id:          string;
  business_id:        string;
  intent_score:       number;    // 0–1: how actionable
  sector_match:       number;    // 0–1: sector relevance
  location_relevance: number;    // 0–1: geo relevance to business
  urgency_score:      number;    // 0–1
  novelty_score:      number;    // 0–1: not seen before
  confidence:         number;    // 0–1: classifier confidence
  composite_score:    number;    // weighted blend of above
  classified_at:      string;
}

export interface SectorTrend {
  id:        string;
  keyword:   string;
  z_score:   number;
  momentum:  'rising' | 'falling' | 'stable';
  sector:    string;
  timestamp: string;
}

export interface EventOpportunity {
  id:                string;
  event_id:          string;
  opportunity_score: number;
  affected_sectors:  string[];
  description:       string;
  created_at:        string;
}

/** Business-scoped opportunity detected from signals + events + forecasts */
export interface Opportunity {
  id:                    string;
  business_id:           string;
  type:                  OpportunityType;
  source_signal_ids:     string[];
  source_event_ids:      string[];
  source_forecast_ids:   string[];
  opportunity_score:     number;    // 0–1
  urgency:               UrgencyLevel;
  confidence:            number;    // 0–1
  expected_window_start: string | null;
  expected_window_end:   string | null;
  explanation:           string;
  dedup_key:             string;    // deterministic: type + business + window
  status:                OpportunityStatus;
  created_at:            string;
  updated_at:            string;
}

export type OpportunityType =
  | 'demand_spike'
  | 'competitor_gap'
  | 'seasonal_window'
  | 'local_event'
  | 'reputation_recovery'
  | 'lead_surge'
  | 'cross_sell'
  | 'retention_risk'
  | 'pricing_opportunity'
  | 'expansion_signal';

export type OpportunityStatus =
  | 'detected'
  | 'qualified'
  | 'fused'
  | 'decided'
  | 'recommended'
  | 'expired'
  | 'archived';

/** Business-scoped threat detected from signals */
export interface Threat {
  id:               string;
  business_id:      string;
  type:             ThreatType;
  source_signal_ids: string[];
  risk_score:       number;    // 0–1
  urgency:          UrgencyLevel;
  confidence:       number;    // 0–1
  explanation:      string;
  dedup_key:        string;
  status:           ThreatStatus;
  created_at:       string;
  updated_at:       string;
}

export type ThreatType =
  | 'negative_review_spike'
  | 'competitor_promotion'
  | 'lead_drop'
  | 'reputation_attack'
  | 'price_undercut'
  | 'demand_drop'
  | 'service_gap';

export type ThreatStatus = 'detected' | 'active' | 'mitigated' | 'expired' | 'archived';

// ─── Prediction Layer ─────────────────────────────────────────────────────────

export interface DemandForecast {
  id:                    string;
  business_id:           string;
  forecast_window:       string;           // '24h' | '3d' | '7d' | '14d'
  expected_demand_score: number;           // 0–100
  demand_delta_pct:      number;           // change vs baseline
  confidence:            number;           // 0–1
  factors:               ForecastFactor[];
  created_at:            string;
}

export interface ForecastFactor {
  name:        string;
  weight:      number;
  description: string;
}

// ─── Context & Fusion Layer ───────────────────────────────────────────────────

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

/** Meta-configuration per business — governs pipeline behavior */
export interface MetaConfiguration {
  business_id:            string;
  sector:                 string;
  auto_execute_enabled:   boolean;
  min_confidence_threshold: number;    // default 0.30
  min_score_threshold:    number;      // default 30
  approval_required_channels: string[]; // channels that always require approval
  signal_keywords:        string[];
  local_radius_meters:    number;
}

/** Full enriched context passed through pipeline */
export interface EnrichedContext {
  context_id:   string;
  business_id:  string;
  built_at:     string;
  trace_id?:    string;

  profile: {
    name:        string;
    category:    string;
    city:        string;
    plan_id:     string | null;
    website?:    string;
    description?: string | null;
    owner_name?:  string | null;
    phone?:       string | null;
  };

  meta_configuration: MetaConfiguration | null;

  // Raw recent signals (last 48h)
  recent_signals: Array<{
    id:           string;
    summary:      string;
    category:     string | null;
    impact_level: string | null;
    detected_at:  string | null;
  }>;

  // Aggregated signal counts + classified items
  signals: {
    total:        number;
    high_urgency: number;
    items?:       ClassifiedSignal[];
  };

  // Detected opportunities (active, not expired)
  active_opportunities: Opportunity[];

  // Detected threats (active)
  active_threats: Threat[];

  // From prediction layer
  trends:    SectorTrend[];
  forecasts: DemandForecast[];

  competitors: Array<{
    name:            string;
    rating:          number | null;
    trend_direction: string | null;
    recent_changes?: string[];
  }>;

  leads: {
    total:     number;
    hot:       number;
    warm:      number;
    new:       number;
    avg_score: number;
  };

  health_score:   number | null;
  health_details: Record<string, number | null>;

  reviews: {
    total:             number;
    avg_rating:        number | null;
    negative_last7d:   number;
    pending_response:  number;
  };

  sector_knowledge: {
    avg_rating:        number | null;
    trending_services: string | null;
    winner_lead_dna:   Record<string, unknown> | null;
  } | null;

  active_predictions: Array<{
    title:      string;
    confidence: number | null;
    timeframe:  string | null;
    impact:     string | null;
  }>;

  // Learned business preferences
  memory: BusinessMemorySnapshot | null;

  // Recent decisions (last 7 days) — for duplicate detection
  recent_decisions: Array<{
    id:             string;
    action_type:    string;
    status:         string;
    score?:         number;
    created_at:     string;
  }>;

  // Recent outcomes — for calibration
  recent_outcomes: Array<{
    id:             string;
    decision_id:    string;
    outcome_type:   string;
    outcome_score:  number | null;
    conversion_flag: boolean;
    created_at:     string;
  }>;

  recent_decisions_summary: string[];

  // ── Intelligence Layer outputs (injected by MasterOrchestrator after market_intelligence stage)
  market_insights:  Insight[];       // structured insights from all intelligence engines
  trust_state:      TrustState | null;
  churn_risk_state: ChurnRiskState | null;
}

/** Learned business preferences — persisted in BusinessMemory table */
export interface BusinessMemorySnapshot {
  business_id:                string;
  preferred_tone:             string;
  preferred_channels:         string[];
  rejected_patterns:          string[];
  accepted_patterns:          string[];
  agent_weights:              Record<string, number>;
  lead_preferences:           Record<string, unknown>;
  content_style:              Record<string, unknown>;
  feedback_summary:           Record<string, unknown>;
  channel_preferences:        Record<string, number>;  // channel -> score
  timing_preferences:         Record<string, number>;  // hour/day -> score
  tone_preferences:           string[];
  sector_specific_preferences: Record<string, unknown>;
  last_updated_at:            string;
}

/** Fused insight — the intelligence layer's output */
export interface FusedInsight {
  id:                    string;
  business_id:           string;
  trace_id:              string;
  primary_type:          'opportunity' | 'threat' | 'mixed';
  top_summary:           string;       // short headline for UI
  top_opportunity:       string;       // legacy compat
  urgency:               UrgencyLevel;
  confidence:            number;
  expected_business_impact: string;
  expected_impact:       string;       // legacy compat
  explanation:           string;
  contributing_items:    ContributingItem[];
  contributing_signals:  string[];     // signal IDs — for traceability
  suggested_action_types: ActionType[];
  raw_signals_count:     number;
  trends_count:          number;
  created_at:            string;
}

export interface ContributingItem {
  type:  'signal' | 'opportunity' | 'threat' | 'forecast' | 'review';
  id:    string;
  label: string;
  score: number;
}

// ─── Decision Layer ───────────────────────────────────────────────────────────

export type ActionType =
  | 'content'
  | 'campaign'
  | 'promotion'
  | 'outreach'
  | 'reputation'
  | 'retention'
  | 'pricing'
  | 'expansion'
  | 'competitor_response'
  | 'alert';

export type ExecutionMode = 'suggest' | 'draft' | 'approval' | 'auto';

export type DecisionStatus =
  | 'created'
  | 'scored'
  | 'recommended'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'measured'
  | 'learned';

export interface Decision {
  id:                string;
  business_id:       string;
  fused_insight_id:  string;
  insight_id:        string;    // alias for fused_insight_id
  trace_id:          string;
  action_type:       ActionType;
  chosen_action_type: ActionType;  // spec alias
  title:             string;
  decision_reasoning: string;
  reasoning:         string;    // legacy alias
  priority:          number;
  score:             number;
  score_breakdown:   ScoreBreakdown;
  confidence:        number;
  expected_roi:      number;
  execution_mode:    ExecutionMode;
  approval_required: boolean;
  policy_version:    number;
  status:            DecisionStatus;
  tags:              string[];
  context_snapshot:  string;
  created_at:        string;
  expires_at:        string;
}

export interface ScoreBreakdown {
  expected_roi:       number;
  confidence:         number;
  business_fit:       number;
  timing_fit:         number;
  historical_success: number;
  final_score:        number;
}

/** User-facing recommendation */
export interface Recommendation {
  id:                   string;
  business_id:          string;
  decision_id:          string;
  trace_id:             string;
  // Traceability chain
  insight_id?:          string;
  opportunity_ids?:     string[];
  signal_ids?:          string[];
  // Content
  title:                string;
  summary:              string;    // short for card
  body:                 string;    // full description
  why_now:              string;    // urgency explanation
  cta:                  string;
  channel:              string;
  recommended_channel:  string;   // spec field
  urgency:              UrgencyLevel;
  estimated_impact:     string;
  expected_impact:      string;   // spec field alias
  recommended_steps:    string[];
  action_steps:         string[];  // legacy alias
  recommended_timing:   string | null;
  draft_content?:       string;
  // UI payload — everything needed to render the recommendation card
  user_visible_payload: RecommendationUIPayload;
  status:               string;
  created_at:           string;
  shown_at?:            string;
  acted_on_at?:         string;
}

export interface RecommendationUIPayload {
  title:           string;
  summary:         string;
  why_now:         string;
  expected_impact: string;
  steps:           string[];
  channel:         string;
  urgency:         UrgencyLevel;
  confidence:      number;
  trace: {
    signal_count:    number;
    opportunity_ids: string[];
    insight_id:      string;
    decision_id:     string;
  };
}

// ─── Execution Layer ──────────────────────────────────────────────────────────

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'prepared'
  | 'awaiting_approval'
  | 'approved'
  | 'dispatched'
  | 'failed'
  | 'completed'
  | 'canceled';

export interface ExecutionTask {
  id:                string;
  business_id:       string;
  decision_id:       string;
  recommendation_id: string | null;
  task_type:         string;
  channel:           string;
  payload:           Record<string, unknown>;
  status:            TaskStatus;
  approval_required: boolean;
  scheduled_for:     string | null;
  attempts:          number;
  max_attempts:      number;
  created_at:        string;
  started_at?:       string;
  executed_at?:      string;
  completed_at?:     string;
  result_payload?:   Record<string, unknown>;
  error?:            string;
}

export interface SentAction {
  id:          string;
  task_id:     string;
  business_id: string;
  channel:     string;
  sent_at:     string;
  result:      string;
  success:     boolean;
}

// ─── Learning Layer ───────────────────────────────────────────────────────────

export type FeedbackType =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'comment'
  | 'correction'
  | 'ignore'
  | 'edit'
  | 'manual_override';

export interface FeedbackEvent {
  id:                 string;
  business_id:        string;
  user_id?:           string;
  output_id:          string | null;
  output_type:        string;
  feedback_type:      FeedbackType;
  agent_name:         string;
  module:             string;
  score:              number;           // -1 | 0 | 1
  comment?:           string;
  tags:               string[];
  correction?:        string;
  correction_payload: Record<string, unknown> | null;
  action_taken?:      string;
  created_at:         string;
}

export interface BehaviorEvent {
  id:          string;
  user_id:     string;
  business_id: string;
  action_type: 'click' | 'edit' | 'ignore' | 'accept' | 'reject' | 'share';
  target_type: string;
  target_id:   string;
  metadata:    Record<string, unknown>;
  created_at:  string;
}

export interface OutcomeEvent {
  id:                string;
  business_id:       string;
  decision_id:       string;
  execution_task_id: string | null;
  agent_name:        string;
  outcome_type:      OutcomeType;
  outcome_score:     number | null;    // 0–1
  result:            'success' | 'failure' | 'partial';
  revenue_impact:    number | null;
  conversion_flag:   boolean;
  notes:             string;
  timestamp:         string;
  created_at:        string;
}

export type OutcomeType =
  | 'manual_mark'
  | 'auto_execution'
  | 'revenue_linked'
  | 'conversion'
  | 'rejection';

export interface PolicyWeight {
  agent_name:    string;
  action_type:   string;
  weight:        number;
  success_rate:  number;
  sample_size:   number;
  last_updated:  string;
  policy_version: number;
}

export interface WeightUpdateLog {
  id:           string;
  business_id:  string;
  agent_name:   string;
  action_type:  string;
  old_weight:   number;
  new_weight:   number;
  trigger_type: 'feedback' | 'outcome' | 'cycle' | 'override';
  trigger_id:   string | null;
  delta:        number;
  reason:       string;
  created_at:   string;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'ingest'
  | 'classify'
  | 'opportunities'
  | 'market_intelligence'
  | 'trends'
  | 'predict'
  | 'context'
  | 'fuse'
  | 'decide'
  | 'score'
  | 'recommend'
  | 'dispatch'
  | 'learn';

export interface PipelineRun {
  run_id:        string;
  business_id:   string;
  trace_id:      string;
  mode:          'full' | 'partial' | 'signal_only' | 'decision_only';
  triggered_by:  'schedule' | 'manual' | 'event' | 'webhook';
  started_at:    string;
  completed_at?: string;
  status:        'running' | 'completed' | 'failed' | 'skipped';
  stages:        Record<PipelineStage, StageResult>;
  summary:       PipelineSummary;
}

export interface StageResult {
  status:      'ok' | 'skipped' | 'error' | 'pending';
  duration_ms: number;
  items:       number;
  error?:      string;
}

export interface PipelineSummary {
  signals_processed:    number;
  opportunities_found:  number;
  threats_found:        number;
  insights_created:     number;
  decisions_created:    number;
  actions_dispatched:   number;
  duration_ms:          number;
}

// ─── Intelligence Layer — Structured Insight ──────────────────────────────────

export type InsightType =
  | 'supply_demand_mismatch'
  | 'white_space'
  | 'ghost_demand'
  | 'price_vacuum'
  | 'workforce_pattern'
  | 'timing_arbitrage'
  | 'trust_gap'
  | 'invisible_churn';

export type InsightCategory =
  | 'opportunity'
  | 'threat'
  | 'optimization'
  | 'retention'
  | 'trust';

export type InsightImpact = 'low' | 'medium' | 'high' | 'critical';

/**
 * Structured intelligence output from any intelligence engine.
 * These flow through MarketIntelligenceService → InsightFusion → DecisionEngine.
 */
export interface Insight {
  id:                       string;
  business_id:              string;
  engine:                   string;          // producing engine name
  type:                     InsightType;
  category:                 InsightCategory;
  title:                    string;
  summary:                  string;
  supporting_signals:       string[];        // signal IDs
  confidence:               number;          // 0–1
  urgency:                  UrgencyLevel;
  business_fit:             number;          // 0–1, relevance to this business
  timeframe:                string;          // 'immediate' | '24h' | '7d' | '30d'
  estimated_impact:         InsightImpact;
  recommended_action_types: ActionType[];
  metadata:                 Record<string, unknown>;
  dedup_key:                string;
  created_at:               string;
}

/** Aggregated trust state produced by TrustSignalAggregator */
export interface TrustState {
  trust_score:      number;          // 0–100
  vs_competitors:   number;          // -1 (lagging) to +1 (leading)
  review_velocity:  number;          // new reviews per week
  response_rate:    number;          // 0–1
  signal_strength:  'weak' | 'moderate' | 'strong';
  gap_type:         'lagging' | 'on_par' | 'leading';
  recommendations:  string[];
}

/** Churn risk state produced by InvisibleChurnPredictor */
export interface ChurnRiskState {
  risk_level:           'low' | 'medium' | 'high' | 'critical';
  risk_score:           number;     // 0–1
  indicators:           string[];
  estimated_churn_pct:  number;     // 0–1
  top_risk_factor:      string;
  window_days:          number;
}
