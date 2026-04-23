/**
 * Repository interfaces — IRepository contracts.
 *
 * All repository implementations must satisfy these interfaces.
 * Keeps orchestration logic decoupled from persistence layer.
 */

import type {
  Signal,
  ClassifiedSignal,
  Opportunity,
  Threat,
  Decision,
  Recommendation,
  ExecutionTask,
  OutcomeEvent,
  BusinessMemorySnapshot,
} from '../models';

// ─── Signal ───────────────────────────────────────────────────────────────────

export interface ISignalRepository {
  save(signal: Signal): Promise<void>;
  findByHash(hash: string): Promise<Signal | null>;
  getRecent(businessId: string, limitHours?: number): Promise<ClassifiedSignal[]>;
  getByIds(ids: string[]): Promise<Signal[]>;
  countByBusiness(businessId: string, sinceHours?: number): Promise<{ total: number; high_urgency: number }>;
}

// ─── Opportunity ──────────────────────────────────────────────────────────────

export interface IOpportunityRepository {
  upsert(opp: Opportunity): Promise<{ id: string; is_new: boolean }>;
  getActive(businessId: string, limit?: number): Promise<Opportunity[]>;
  getByIds(ids: string[]): Promise<Opportunity[]>;
  transition(id: string, from: string, to: string): Promise<void>;
  expireStale(businessId: string): Promise<void>;
}

// ─── Threat ───────────────────────────────────────────────────────────────────

export interface IThreatRepository {
  upsert(threat: Threat): Promise<{ id: string; is_new: boolean }>;
  getActive(businessId: string, limit?: number): Promise<Threat[]>;
  transition(id: string, from: string, to: string): Promise<void>;
  expireStale(businessId: string): Promise<void>;
}

// ─── Decision ─────────────────────────────────────────────────────────────────

export interface IDecisionRepository {
  save(decision: Decision): Promise<void>;
  getById(id: string): Promise<Decision | null>;
  getRecent(businessId: string, limitDays?: number): Promise<Array<{
    id: string; action_type: string; status: string; score?: number; created_at: string;
  }>>;
  updateStatus(id: string, status: string): Promise<void>;
  savePipelineRun(runId: string, businessId: string, meta: Record<string, unknown>): Promise<void>;
}

// ─── Recommendation ───────────────────────────────────────────────────────────

export interface IRecommendationRepository {
  save(rec: Recommendation): Promise<void>;
  getById(id: string): Promise<Recommendation | null>;
  getByDecisionId(decisionId: string): Promise<Recommendation[]>;
  getByBusinessId(businessId: string, limit?: number): Promise<Recommendation[]>;
  updateStatus(id: string, status: string): Promise<void>;
}

// ─── Execution ────────────────────────────────────────────────────────────────

export interface IExecutionRepository {
  saveTask(task: ExecutionTask): Promise<void>;
  getTask(taskId: string): Promise<ExecutionTask | null>;
  updateTaskStatus(taskId: string, status: string, error?: string): Promise<void>;
  getByDecisionId(decisionId: string): Promise<ExecutionTask[]>;
  getByIdempotencyKey(key: string): Promise<ExecutionTask | null>;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export interface IFeedbackRepository {
  save(feedback: {
    id: string;
    business_id: string;
    output_id: string;
    feedback_type: string;
    score: number;
    comment?: string;
    tags?: string[];
    correction_payload?: Record<string, unknown>;
    created_at: string;
  }): Promise<void>;
  getRecent(businessId: string, limitDays?: number): Promise<Array<{
    id: string;
    score: number;
    agent_name: string | null;
    output_type: string | null;
    tags: string | null;
    feedback_type?: string;
  }>>;
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

export interface IOutcomeRepository {
  save(outcome: OutcomeEvent): Promise<void>;
  getByDecisionId(decisionId: string): Promise<OutcomeEvent[]>;
  getSuccessRate(businessId: string, agentName: string): Promise<number>;
  getRecent(businessId: string, limitDays?: number): Promise<OutcomeEvent[]>;
}

// ─── Business Memory ──────────────────────────────────────────────────────────

export interface IBusinessMemoryRepository {
  get(businessId: string): Promise<BusinessMemorySnapshot | null>;
  upsert(businessId: string, snapshot: Partial<BusinessMemorySnapshot>): Promise<void>;
  getPolicyWeight(businessId: string, agentName: string, actionType: string): Promise<number>;
  savePolicyWeight(params: {
    business_id: string;
    agent_name: string;
    action_type: string;
    weight: number;
    success_rate: number;
    sample_size: number;
    policy_version: string;
  }): Promise<void>;
}
