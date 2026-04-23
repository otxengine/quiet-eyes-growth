/**
 * Unit tests — KPIService
 *
 * Verifies:
 * - Funnel conversion rates computed correctly (rate = num/denom)
 * - Zero-division handled gracefully (all rates = 0 when denominator = 0)
 * - learning_improvement = 7d accuracy - 30d accuracy
 * - Revenue totals are numeric
 * - window_days is reflected in output
 * - Tenant KPI aggregation shape
 * - PipelineVelocity p50/p95 percentile correctness
 */

import { computeFunnelKPIs, computePipelineVelocity, computeTenantKPIs } from '../services/metrics/KPIService';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}));

import { prisma } from '../db';

function mockQuery(returnValue: any) {
  (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce(returnValue);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── computeFunnelKPIs ────────────────────────────────────────────────────────

describe('computeFunnelKPIs', () => {
  function setupMocks(overrides: {
    insights?: number; decisions?: number; recs?: number;
    dispatched?: number; completed?: number; outcomes?: [number, number];
    feedback?: [number, number]; agents?: any[]; agents7d?: any[];
  } = {}) {
    const {
      insights = 10, decisions = 8, recs = 7,
      dispatched = 5, completed = 4,
      outcomes = [3, 1200], feedback = [6, 4],
      agents = [], agents7d = [],
    } = overrides;

    mockQuery([{ n: String(insights) }]);
    mockQuery([{ n: String(decisions) }]);
    mockQuery([{ n: String(recs) }]);
    mockQuery([{ n: String(dispatched) }]);
    mockQuery([{ n: String(completed) }]);
    mockQuery([{ n: String(outcomes[0]), revenue: String(outcomes[1]) }]);
    mockQuery([{ total: String(feedback[0]), positive: String(feedback[1]) }]);
    mockQuery(agents);
    mockQuery(agents7d);
  }

  test('computes insight_to_decision_rate correctly', async () => {
    setupMocks({ insights: 10, decisions: 8 });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.insight_to_decision_rate).toBe(0.8);
  });

  test('computes decision_to_execution_rate correctly', async () => {
    setupMocks({ decisions: 8, dispatched: 4 });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.decision_to_execution_rate).toBe(0.5);
  });

  test('computes execution_success_rate correctly', async () => {
    setupMocks({ dispatched: 5, completed: 4 });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.execution_success_rate).toBe(0.8);
  });

  test('computes feedback_ratio correctly', async () => {
    setupMocks({ recs: 7, feedback: [6, 4] });
    const kpis = await computeFunnelKPIs('biz_001');
    // 6/7 ≈ 0.857
    expect(kpis.feedback_ratio).toBeCloseTo(6 / 7, 2);
  });

  test('computes positive_feedback_rate correctly', async () => {
    setupMocks({ feedback: [6, 4] });
    const kpis = await computeFunnelKPIs('biz_001');
    // 4/6 ≈ 0.667
    expect(kpis.positive_feedback_rate).toBeCloseTo(4 / 6, 2);
  });

  test('returns 0 rates when denominators are zero', async () => {
    setupMocks({ insights: 0, decisions: 0, recs: 0, dispatched: 0, completed: 0, feedback: [0, 0] });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.insight_to_decision_rate).toBe(0);
    expect(kpis.decision_to_execution_rate).toBe(0);
    expect(kpis.execution_success_rate).toBe(0);
    expect(kpis.feedback_ratio).toBe(0);
    expect(kpis.positive_feedback_rate).toBe(0);
  });

  test('includes revenue_impact_total as number', async () => {
    setupMocks({ outcomes: [3, 2500] });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.revenue_impact_total).toBe(2500);
  });

  test('window_days is reflected in output', async () => {
    setupMocks();
    const kpis = await computeFunnelKPIs('biz_001', 7);
    expect(kpis.window_days).toBe(7);
  });

  test('learning_improvement = 7d - 30d accuracy', async () => {
    const agents30d = [
      { agent_name: 'AgentA', total_outputs: '10', accuracy_score: '0.6', positive_count: '6', negative_count: '4' },
    ];
    const agents7d = [
      { agent_name: 'AgentA', total: '5', positive: '4' },  // 7d accuracy = 0.8
    ];
    setupMocks({ agents: agents30d, agents7d });
    const kpis = await computeFunnelKPIs('biz_001');
    // 30d = 0.6, 7d = 0.8, improvement = 0.2
    expect(kpis.learning_accuracy_30d).toBe(0.6);
    expect(kpis.learning_accuracy_7d).toBe(0.8);
    expect(kpis.learning_improvement).toBeCloseTo(0.2, 2);
  });

  test('negative improvement when accuracy declined', async () => {
    const agents30d = [
      { agent_name: 'AgentA', total_outputs: '10', accuracy_score: '0.8', positive_count: '8', negative_count: '2' },
    ];
    const agents7d = [
      { agent_name: 'AgentA', total: '5', positive: '2' },  // 7d = 0.4
    ];
    setupMocks({ agents: agents30d, agents7d });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.learning_improvement).toBeLessThan(0);
  });

  test('agent_accuracy list is populated', async () => {
    const agents = [
      { agent_name: 'ContentAgent', total_outputs: '20', accuracy_score: '0.75', positive_count: '15', negative_count: '5' },
    ];
    setupMocks({ agents });
    const kpis = await computeFunnelKPIs('biz_001');
    expect(kpis.agent_accuracy).toHaveLength(1);
    expect(kpis.agent_accuracy[0].agent_name).toBe('ContentAgent');
    expect(kpis.agent_accuracy[0].accuracy).toBe(0.75);
  });

  test('computed_at is a valid ISO timestamp', async () => {
    setupMocks();
    const kpis = await computeFunnelKPIs('biz_001');
    expect(() => new Date(kpis.computed_at)).not.toThrow();
    expect(new Date(kpis.computed_at).getTime()).toBeGreaterThan(0);
  });
});

// ─── computePipelineVelocity ──────────────────────────────────────────────────

describe('computePipelineVelocity', () => {
  test('computes avg, p50, p95 from run durations', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({
      duration_ms: String((i + 1) * 100),
      started_at:  new Date(Date.now() - i * 3_600_000).toISOString(),
    }));
    (prisma.$queryRawUnsafe as jest.Mock)
      .mockResolvedValueOnce(runs)
      .mockResolvedValueOnce([{ started_at: runs[0].started_at }]);

    const velocity = await computePipelineVelocity('biz_001');
    expect(velocity.avg_cycle_ms).toBeGreaterThan(0);
    expect(velocity.p50_cycle_ms).toBeGreaterThan(0);
    expect(velocity.p95_cycle_ms).toBeGreaterThan(velocity.p50_cycle_ms);
    expect(velocity.runs_last_30d).toBe(20);
  });

  test('returns zeros when no runs exist', async () => {
    (prisma.$queryRawUnsafe as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const velocity = await computePipelineVelocity('biz_001');
    expect(velocity.avg_cycle_ms).toBe(0);
    expect(velocity.last_run_at).toBeNull();
  });
});

// ─── computeTenantKPIs ────────────────────────────────────────────────────────

describe('computeTenantKPIs', () => {
  test('returns tenant-level aggregates', async () => {
    (prisma.$queryRawUnsafe as jest.Mock)
      .mockResolvedValueOnce([{ n: '5' }])    // business count
      .mockResolvedValueOnce([{ n: '8' }])    // decision count
      .mockResolvedValueOnce([{ n: '3', revenue: '5000' }]);

    const kpis = await computeTenantKPIs('tenant_001');
    expect(kpis.tenant_id).toBe('tenant_001');
    expect(kpis.business_count).toBe(5);
    expect(kpis.total_revenue).toBe(5000);
  });
});
