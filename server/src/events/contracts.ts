/**
 * OTXEngine Event Contracts — v3
 *
 * RULES:
 *  1. Every event carries: event_id, type, entity_id (business), payload, timestamp, trace_id, version
 *  2. No agent talks directly to another — only through events
 *  3. Each pipeline stage emits exactly one completion event
 *  4. trace_id threads through the entire pipeline run
 *  5. All payload interfaces are strict — no optional fields on critical IDs
 */

// ─── Event type registry ──────────────────────────────────────────────────────

export type OTXEventType =
  // Ingestion Layer
  | 'signal.collected'
  | 'signal.classified'
  | 'competitor.change.detected'
  | 'event.raw.collected'
  // Intelligence Layer
  | 'opportunity.detected'
  | 'opportunity.state_changed'
  | 'threat.detected'
  | 'trend.detected'
  | 'event.opportunity.created'
  | 'intent.classified'
  | 'insight.generated'
  | 'market.intelligence.complete'
  | 'trust.analyzed'
  | 'churn.risk.detected'
  // Prediction Layer
  | 'forecast.updated'
  | 'demand.spike.detected'
  // Context & Fusion Layer
  | 'context.built'
  | 'insight.fused'
  // Decision Layer
  | 'decision.created'
  | 'decision.scored'
  | 'decision.eligibility_failed'
  | 'recommendation.generated'
  // Execution Layer
  | 'execution.requested'
  | 'execution.approval_required'
  | 'execution.completed'
  | 'action.dispatched'
  | 'action.executed'
  | 'action.failed'
  // Learning Layer
  | 'feedback.received'
  | 'outcome.recorded'
  | 'memory.updated'
  | 'weights.updated'
  | 'pattern.detected'
  // Orchestration
  | 'orchestration.started'
  | 'orchestration.stage.completed'
  | 'orchestration.completed'
  | 'orchestration.failed'
  | 'orchestration.skipped';

// ─── Base event envelope ──────────────────────────────────────────────────────

export interface OTXEvent<T = unknown> {
  event_id:  string;
  type:      OTXEventType;
  entity_id: string;    // businessProfileId
  payload:   T;
  timestamp: string;    // ISO 8601
  trace_id:  string;    // threaded across entire pipeline run
  version:   number;    // schema version — default 1
}

// ─── Ingestion payloads ───────────────────────────────────────────────────────

export interface SignalCollectedPayload {
  event_id:     string;
  signal_id:    string;
  business_scope: string;
  source:       string;
  collected_at: string;
  hash:         string;
}

export interface SignalClassifiedPayload {
  event_id:           string;
  signal_id:          string;
  classified_signal_id: string;
  relevance_score:    number;
  urgency_score:      number;
  confidence:         number;
  novelty_score:      number;
}

export interface CompetitorChangePayload {
  competitor_id:   string;
  business_id:     string;
  change_type:     'rating' | 'price' | 'service' | 'promotion' | 'new_competitor';
  previous_value:  string | null;
  new_value:       string;
  severity:        'low' | 'medium' | 'high';
}

// ─── Intelligence payloads ────────────────────────────────────────────────────

export interface OpportunityDetectedPayload {
  event_id:          string;
  opportunity_id:    string;
  business_id:       string;
  type:              string;
  opportunity_score: number;
  urgency:           string;
  confidence:        number;
  dedup_key:         string;
  is_new:            boolean;   // false = merged with existing
}

export interface OpportunityStateChangedPayload {
  event_id:       string;
  opportunity_id: string;
  business_id:    string;
  from_status:    string;
  to_status:      string;
}

export interface ThreatDetectedPayload {
  event_id:    string;
  threat_id:   string;
  business_id: string;
  type:        string;
  risk_score:  number;
  urgency:     string;
  confidence:  number;
  dedup_key:   string;
  is_new:      boolean;
}

export interface TrendDetectedPayload {
  business_id:   string;
  keyword:       string;
  z_score:       number;
  sector:        string;
  momentum:      'rising' | 'falling' | 'stable';
  trend_count:   number;
}

export interface EventOpportunityPayload {
  business_id:       string;
  event_id:          string;
  opportunity_score: number;
  affected_sectors:  string[];
  description:       string;
}

export interface IntentClassifiedPayload {
  business_id:      string;
  signal_id:        string;
  intent_score:     number;
  sector_match:     string;
  urgency_score:    number;
  novelty_score:    number;
}

// ─── Intelligence engine payloads ─────────────────────────────────────────────

export interface InsightGeneratedPayload {
  event_id:    string;
  insight_id:  string;
  business_id: string;
  engine:      string;
  type:        string;
  category:    string;
  urgency:     string;
  confidence:  number;
  dedup_key:   string;
}

export interface MarketIntelligenceCompletePayload {
  event_id:        string;
  business_id:     string;
  insights_count:  number;
  engines_run:     string[];
  top_urgency:     string;
  duration_ms:     number;
  has_trust_gap:   boolean;
  has_churn_risk:  boolean;
}

export interface TrustAnalyzedPayload {
  event_id:       string;
  business_id:    string;
  trust_score:    number;
  gap_type:       string;
  vs_competitors: number;
}

export interface ChurnRiskDetectedPayload {
  event_id:     string;
  business_id:  string;
  risk_level:   string;
  risk_score:   number;
  top_factor:   string;
}

// ─── Prediction payloads ──────────────────────────────────────────────────────

export interface ForecastUpdatedPayload {
  event_id:              string;
  forecast_id:           string;
  business_id:           string;
  forecast_window:       string;
  expected_demand_score: number;
  confidence:            number;
}

export interface DemandSpikePayload {
  business_id:   string;
  spike_factor:  number;
  cause:         string;
  window_hours:  number;
}

// ─── Context & Fusion payloads ────────────────────────────────────────────────

export interface ContextBuiltPayload {
  event_id:             string;
  business_id:          string;
  context_snapshot_id:  string;
  signal_count:         number;
  opportunity_count:    number;
  threat_count:         number;
  competitor_count:     number;
  lead_count:           number;
  health_score:         number | null;
  built_at:             string;
}

export interface InsightFusedPayload {
  event_id:          string;
  fused_insight_id:  string;
  business_id:       string;
  urgency:           string;
  confidence:        number;
  primary_type:      'opportunity' | 'threat' | 'mixed';
  top_summary:       string;
}

// ─── Decision payloads ────────────────────────────────────────────────────────

export interface DecisionCreatedPayload {
  event_id:       string;
  decision_id:    string;
  business_id:    string;
  chosen_action_type: string;
  priority:       number;
  confidence:     number;
  execution_mode: string;
}

export interface DecisionEligibilityFailedPayload {
  event_id:    string;
  business_id: string;
  insight_id:  string;
  action_type: string;
  reason:      'low_confidence' | 'low_novelty' | 'duplicate_active' | 'below_impact_threshold' | 'rejected_pattern';
}

export interface DecisionScoredPayload {
  decision_id:      string;
  business_id:      string;
  final_score:      number;
  roi_component:    number;
  confidence_comp:  number;
  fit_component:    number;
  timing_component: number;
  history_comp:     number;
}

export interface RecommendationGeneratedPayload {
  event_id:          string;
  recommendation_id: string;
  decision_id:       string;
  business_id:       string;
  generated_at:      string;
}

// ─── Execution payloads ───────────────────────────────────────────────────────

export interface ExecutionRequestedPayload {
  event_id:          string;
  execution_task_id: string;
  decision_id:       string;
  task_type:         string;
  approval_required: boolean;
}

export interface ExecutionApprovalRequiredPayload {
  event_id:          string;
  execution_task_id: string;
  decision_id:       string;
  business_id:       string;
  channel:           string;
  recommendation_id: string | null;
}

export interface ExecutionCompletedPayload {
  event_id:          string;
  execution_task_id: string;
  decision_id:       string;
  result_status:     'success' | 'failure' | 'partial';
  completed_at:      string;
}

export interface ActionDispatchedPayload {
  task_id:      string;
  decision_id:  string;
  business_id:  string;
  task_type:    string;
  channel:      string;
}

export interface ActionExecutedPayload {
  task_id:      string;
  business_id:  string;
  channel:      string;
  success:      boolean;
  result:       string;
  sent_at:      string;
}

// ─── Learning payloads ────────────────────────────────────────────────────────

export interface FeedbackReceivedPayload {
  event_id:          string;
  feedback_event_id: string;
  business_id:       string;
  output_type:       string;
  output_id:         string | null;
  feedback_type:     string;
}

export interface OutcomeRecordedPayload {
  event_id:         string;
  outcome_event_id: string;
  business_id:      string;
  decision_id:      string;
  outcome_type:     string;
  outcome_score:    number | null;
}

export interface MemoryUpdatedPayload {
  event_id:       string;
  business_id:    string;
  memory_version: number;
  updated_at:     string;
  update_type:    'incremental' | 'full_cycle';
}

export interface WeightsUpdatedPayload {
  business_id:          string;
  agents_updated:       number;
  avg_accuracy_change:  number;
  policy_version:       number;
}

export interface PatternDetectedPayload {
  business_id:   string;
  pattern_key:   string;
  pattern_label: string;
  signal_type:   'positive_pattern' | 'negative_pattern';
  occurrence:    number;
  weight_delta:  number;
}

// ─── Orchestration payloads ───────────────────────────────────────────────────

export interface OrchestrationStartedPayload {
  run_id:       string;
  business_id:  string;
  mode:         string;
  triggered_by: string;
}

export interface OrchestrationStagePayload {
  run_id:      string;
  business_id: string;
  stage:       string;
  duration_ms: number;
  items:       number;
  status:      'ok' | 'skipped' | 'error';
}

export interface OrchestrationCompletedPayload {
  run_id:              string;
  business_id:         string;
  stages_run:          number;
  duration_ms:         number;
  decisions:           number;
  insights:            number;
  actions:             number;
  opportunities_found: number;
  threats_found:       number;
}

export interface OrchestrationFailedPayload {
  run_id:      string;
  business_id: string;
  stage:       string;
  error:       string;
}
