import { computeCompetitorDiscoveryMetrics } from '../services/metrics/KPIService';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn() },
}));

const queryRaw = prisma.$queryRawUnsafe as jest.Mock;

const COMPETITOR = (overrides: Partial<{ not_relevant: boolean | null; discovery_sources: string | null }>) => ({
  not_relevant: false, discovery_sources: '["google_places"]', ...overrides,
});

const RUN = (overrides: Partial<{ items_processed: number | null; cost_usd: number | null; plan_id: string | null }>) => ({
  items_processed: 3, cost_usd: 0.01, plan_id: 'growth', ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('computeCompetitorDiscoveryMetrics (KAN-216)', () => {
  it('computes precision from kept vs total identified', async () => {
    queryRaw
      .mockResolvedValueOnce([COMPETITOR({ not_relevant: false }), COMPETITOR({ not_relevant: false }), COMPETITOR({ not_relevant: true })])
      .mockResolvedValueOnce([]);

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m.identified_count).toBe(3);
    expect(m.kept_count).toBe(2);
    expect(m.precision).toBeCloseTo(2 / 3);
  });

  it('computes median rivals per scan and cap-utilization from plan caps', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        RUN({ items_processed: 2, plan_id: 'growth' }),  // cap 10 -> 0.2
        RUN({ items_processed: 4, plan_id: 'growth' }),  // cap 10 -> 0.4
        RUN({ items_processed: 9, plan_id: 'pro' }),     // infinite cap -> excluded
      ]);

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m.scan_count).toBe(3);
    expect(m.median_rivals_per_scan).toBe(4);
    expect(m.avg_cap_utilization).toBeCloseTo(0.3);
  });

  it('splits source mix between rows seen by both APIs and by one', async () => {
    queryRaw
      .mockResolvedValueOnce([
        COMPETITOR({ discovery_sources: '["google_places","dataforseo_maps"]' }),
        COMPETITOR({ discovery_sources: '["google_places"]' }),
      ])
      .mockResolvedValueOnce([]);

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m.both_sources_count).toBe(1);
    expect(m.one_source_count).toBe(1);
    expect(m.source_mix_rate).toBe(0.5);
  });

  it('tracks cost per run against budget', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([RUN({ cost_usd: 0.02 }), RUN({ cost_usd: 0.2 })]); // budget is 0.05/run

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m.total_cost_usd).toBeCloseTo(0.22);
    expect(m.avg_cost_per_run_usd).toBeCloseTo(0.11);
    expect(m.over_budget_rate).toBe(0.5);
  });

  it('computes empty rate from scans with zero items processed', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([RUN({ items_processed: 0 }), RUN({ items_processed: 3 })]);

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m.empty_scan_count).toBe(1);
    expect(m.empty_rate).toBe(0.5);
  });

  it('returns all zeros with no data instead of dividing by zero', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const m = await computeCompetitorDiscoveryMetrics('tenant1', 30);

    expect(m).toMatchObject({
      precision: 0, median_rivals_per_scan: 0, avg_cap_utilization: 0,
      source_mix_rate: 0, avg_cost_per_run_usd: 0, over_budget_rate: 0, empty_rate: 0,
    });
  });
});
