/**
 * Unit tests — MasterOrchestrator.runPipeline (KAN-71 AC6)
 *
 * Verifies:
 * - After a pipeline run, decisionRepository.savePipelineRun is called
 *   (writes to otx_pipeline_runs table).
 * - market_signals is NOT written (engines write to market_insights).
 */

// ─── All deps mocked before any import ───────────────────────────────────────

jest.mock('../intelligence/ContextBuilder', () => ({
  buildEnrichedContext: jest.fn(),
}));

jest.mock('../services/intelligence/MarketIntelligenceService', () => ({
  runIntelligenceEngines: jest.fn(),
}));

jest.mock('../services/intelligence/OpportunityDetector', () => ({
  detectOpportunities: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/intelligence/ThreatDetector', () => ({
  detectThreats: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/intelligence/InsightFusion', () => ({
  fuseInsight: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/intelligence/SignalProcessor', () => ({
  processSignals: jest.fn().mockResolvedValue({ classified: [], total_raw: 0, skipped_known: 0, high_urgency: 0 }),
}));

jest.mock('../services/prediction/DemandForecastingService', () => ({
  computeForecasts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/decision/DecisionEngine', () => ({
  makeDecisions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/decision/RecommendationGenerator', () => ({
  generateRecommendations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/execution/ActionDispatcher', () => ({
  dispatchAll: jest.fn().mockResolvedValue({ dispatched: 0 }),
}));

jest.mock('../services/learning/BusinessMemoryEngine', () => ({
  fullMemoryCycle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/learning/PolicyWeightUpdater', () => ({
  runPolicyUpdateCycle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../repositories/DecisionRepository', () => ({
  decisionRepository: {
    savePipelineRun: jest.fn().mockResolvedValue(undefined),
    getRunHistory:   jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../events/EventBus', () => ({
  bus: {
    emit:      jest.fn().mockResolvedValue(undefined),
    makeEvent: jest.fn(() => ({ event_id: 'e', type: 't', entity_id: 'x', payload: {}, timestamp: '', trace_id: '', version: 1 })),
  },
}));

jest.mock('../infra/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../lib/automationLog', () => ({
  writeAutomationLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'test_run_id') }));

import { runPipeline } from '../orchestration/MasterOrchestrator';
import { buildEnrichedContext } from '../intelligence/ContextBuilder';
import { runIntelligenceEngines } from '../services/intelligence/MarketIntelligenceService';
import { decisionRepository } from '../repositories/DecisionRepository';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CTX_STUB = {
  context_id: 'ctx_001', business_id: 'biz_ac6', built_at: new Date().toISOString(),
  trace_id: 'tr', profile: { name: 'Test', category: 'food', city: 'TLV', plan_id: null },
  meta_configuration: null, recent_signals: [],
  signals: { total: 0, high_urgency: 0, items: [] },
  active_opportunities: [], active_threats: [], trends: [], forecasts: [],
  competitors: [], leads: { total: 0, hot: 0, warm: 0, new: 0, avg_score: 0 },
  health_score: 50, health_details: {},
  reviews: { total: 0, avg_rating: 4.0, negative_last7d: 0, pending_response: 0 },
  sector_knowledge: null, active_predictions: [], memory: null,
  recent_decisions: [], recent_outcomes: [], recent_decisions_summary: [],
  market_insights: [], trust_state: null, churn_risk_state: null,
} as any;

const ENGINE_RESULT = {
  insights: [], engines_run: [], duration_ms: 10,
  trust_state: { trust_score: 50, vs_competitors: 0, review_velocity: 0, response_rate: 0, signal_strength: 'weak', gap_type: 'on_par', recommendations: [] },
  churn_risk_state: { risk_level: 'low', risk_score: 0, indicators: [], estimated_churn_pct: 0, top_risk_factor: '', window_days: 30 },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (buildEnrichedContext as jest.Mock).mockResolvedValue(CTX_STUB);
  (runIntelligenceEngines as jest.Mock).mockResolvedValue(ENGINE_RESULT);
});

// ─── AC6: otx_pipeline_runs written after engine run ─────────────────────────

describe('MasterOrchestrator.runPipeline — AC6 otx_pipeline_runs', () => {
  test('savePipelineRun is called after a complete pipeline run', async () => {
    await runPipeline('biz_ac6', { mode: 'full', triggeredBy: 'manual' });
    expect(decisionRepository.savePipelineRun).toHaveBeenCalledWith(
      expect.any(String), // runId
      'biz_ac6',
      expect.objectContaining({ mode: 'full', triggered_by: 'manual', status: 'completed' }),
    );
  });

  test('savePipelineRun summary contains pipeline metrics', async () => {
    await runPipeline('biz_ac6b', { mode: 'full', triggeredBy: 'manual' }); // unique id avoids lastRun cooldown
    const summaryArg = (decisionRepository.savePipelineRun as jest.Mock).mock.calls[0][2];
    expect(typeof summaryArg.duration_ms).toBe('number');
    expect('insights_created' in summaryArg).toBe(true);
    expect('signals_processed' in summaryArg).toBe(true);
  });
});
