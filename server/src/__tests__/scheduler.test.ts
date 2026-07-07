// ── Mocks must be declared before imports ─────────────────────────────────────

jest.mock('node-cron',                        () => ({ schedule: jest.fn() }));
jest.mock('../db',                            () => ({ prisma: { businessProfile: { findMany: jest.fn() } } }));
jest.mock('../lib/agentMonitor',              () => ({ writeHeartbeat: jest.fn() }));
jest.mock('../infra/logger',                  () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) }));
jest.mock('../orchestration/MasterOrchestrator', () => ({ runPipeline: jest.fn() }));
jest.mock('../services/execution/executeOrQueue', () => ({ processScheduledAutoActions: jest.fn() }));
jest.mock('../lib/tiktokTokenRefresh',        () => ({ refreshExpiringTikTokTokens: jest.fn() }));
// Transitive deps loaded by route-function modules
jest.mock('../lib/llm',                       () => ({ invokeLLM:            jest.fn() }));
jest.mock('../lib/tavily',                    () => ({ tavilySearch:         jest.fn() }));
jest.mock('../lib/automationLog',             () => ({ writeAutomationLog:   jest.fn() }));
jest.mock('../lib/eventBus',                  () => ({ publishEvent:         jest.fn() }));
jest.mock('../lib/agentCache',                () => ({ shouldSkipAgent:      jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/apify',                     () => ({ runApifyActor:        jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/searchapi',                 () => ({ hasSearchApiKey:      jest.fn(), searchInstagramPosts: jest.fn() }));
jest.mock('../lib/serpapi',                   () => ({}));
jest.mock('../lib/ai_router',                 () => ({}));
jest.mock('../lib/gemini',                    () => ({}));
jest.mock('../lib/bootstrapIntelligence',     () => ({}));
jest.mock('../lib/businessContext',           () => ({}));
jest.mock('../lib/businessProfile',           () => ({}));
jest.mock('../lib/campaignBenchmarks',        () => ({}));
jest.mock('../lib/competitorAdsIntel',        () => ({}));
jest.mock('../lib/constraintValidator',       () => ({}));
jest.mock('../lib/dataSources',               () => ({}));
jest.mock('../lib/email',                     () => ({}));
jest.mock('../lib/eventbrite',                () => ({}));
jest.mock('../lib/executionDecider',          () => ({}));
jest.mock('../lib/insightDedup',              () => ({}));
jest.mock('../lib/missionPlanner',            () => ({}));
jest.mock('../lib/routingEngine',             () => ({}));
jest.mock('../lib/sectorContext',             () => ({}));
jest.mock('../lib/sectorInsightConfig',       () => ({}));
jest.mock('../lib/sectorPrompts',             () => ({}));
jest.mock('../lib/signalGuard',               () => ({ normReviewOrigin: jest.fn() }));
jest.mock('../lib/trendMemory',               () => ({}));
jest.mock('../middleware/auth',               () => ({}));

import cron from 'node-cron';
import { prisma } from '../db';
import { writeHeartbeat } from '../lib/agentMonitor';
import { runAgentForAll, startScheduler } from '../scheduler';

const bpFindMany = prisma.businessProfile.findMany as jest.Mock;
const heartbeat  = writeHeartbeat as jest.Mock;

afterEach(() => jest.useRealTimers());

describe('KAN-24: scheduler cron + runAgentForAll', () => {
  // ── AC1 ─────────────────────────────────────────────────────────────────────
  it('AC1: registers 05:30 ingestion cron and 07:00 pipeline cron', () => {
    startScheduler();
    const registered = (cron.schedule as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(registered).toContain('30 5 * * *');
    expect(registered).toContain('0 7 * * *');
  });

  // ── KAN-87 AC7: 02:00 trend pack ─────────────────────────────────────────────
  it('KAN-87 AC7: registers 02:00 UTC trend intelligence cron', () => {
    startScheduler();
    const registered = (cron.schedule as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(registered).toContain('0 2 * * *');
  });

  // ── AC2 ─────────────────────────────────────────────────────────────────────
  it('AC2: retries agentFn once after 3s and succeeds on second call', async () => {
    jest.useFakeTimers();
    bpFindMany.mockResolvedValue([{ id: 'biz-1', name: 'B1' }]);
    const agentFn = jest.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue(undefined);

    const p = runAgentForAll('Test', agentFn);
    await jest.advanceTimersByTimeAsync(4000);
    await p;

    expect(agentFn).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenLastCalledWith('Test', 'biz-1', 'ok');
  });

  it('AC2b: writes failed heartbeat when both attempts throw', async () => {
    jest.useFakeTimers();
    bpFindMany.mockResolvedValue([{ id: 'biz-1', name: 'B1' }]);
    const agentFn = jest.fn().mockRejectedValue(new Error('always fails'));

    const p = runAgentForAll('Test', agentFn);
    await jest.advanceTimersByTimeAsync(4000);
    await p;

    expect(agentFn).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenLastCalledWith('Test', 'biz-1', 'failed', 'always fails');
  });

  // ── AC3 ─────────────────────────────────────────────────────────────────────
  it('AC3: never runs more than 2 businesses concurrently', async () => {
    bpFindMany.mockResolvedValue(
      ['b1', 'b2', 'b3', 'b4', 'b5'].map(id => ({ id, name: id })),
    );
    let inFlight = 0;
    let peak = 0;
    const agentFn = jest.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve(); // yield to let peer in the same batch start
      inFlight--;
    });

    await runAgentForAll('Test', agentFn);

    expect(agentFn).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
