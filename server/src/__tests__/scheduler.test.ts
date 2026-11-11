// ── Mocks must be declared before imports ─────────────────────────────────────

jest.mock('node-cron',                        () => ({ schedule: jest.fn() }));
jest.mock('../db',                            () => ({ prisma: { $queryRawUnsafe: jest.fn() } }));
jest.mock('../lib/agentMonitor',              () => ({ writeHeartbeat: jest.fn() }));
jest.mock('../infra/logger',                  () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) }));
jest.mock('../orchestration/MasterOrchestrator', () => ({ runPipeline: jest.fn() }));
jest.mock('../services/execution/executeOrQueue', () => ({ processScheduledAutoActions: jest.fn() }));
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
jest.mock('../routes/functions/generateReport', () => ({ generateReport: jest.fn() }));
jest.mock('../routes/functions/collectOwnSocialProfileAndPosts', () => ({ collectOwnSocialProfileAndPosts: jest.fn() }));
jest.mock('../routes/functions/collectCompetitorSocialStories', () => ({ collectCompetitorSocialStories: jest.fn() }));

import cron from 'node-cron';
import { prisma } from '../db';
import { writeHeartbeat } from '../lib/agentMonitor';
import { runAgentForAll, startScheduler, upgradedBriefingReports } from '../scheduler';
import { generateReport } from '../routes/functions/generateReport';
import { collectOwnSocialProfileAndPosts } from '../routes/functions/collectOwnSocialProfileAndPosts';
import { collectCompetitorSocialStories } from '../routes/functions/collectCompetitorSocialStories';

const bpFindMany = prisma.$queryRawUnsafe as jest.Mock;
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
  it('AC3: never runs more than CONCURRENCY (4) businesses concurrently', async () => {
    bpFindMany.mockResolvedValue(
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map(id => ({ id, name: id })),
    );
    let inFlight = 0;
    let peak = 0;
    const agentFn = jest.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve(); // yield to let peers in the same batch start
      inFlight--;
    });

    await runAgentForAll('Test', agentFn);

    expect(agentFn).toHaveBeenCalledTimes(7);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('runAgentForAll region filter (US report schedule)', () => {
  const sqlOf = () => String(bpFindMany.mock.calls[bpFindMany.mock.calls.length - 1][0]);

  it('no region = every active business, as before', async () => {
    bpFindMany.mockResolvedValue([]);
    await runAgentForAll('Test', jest.fn());
    expect(sqlOf()).not.toContain('locale');
  });

  it("'US' = businesses with an English locale, 'IL' = everyone else (incl. no locale)", async () => {
    bpFindMany.mockResolvedValue([]);
    await runAgentForAll('Test', jest.fn(), {}, 'US');
    expect(sqlOf()).toContain("(COALESCE(locale, '') ILIKE 'en%') = true");
    await runAgentForAll('Test', jest.fn(), {}, 'IL');
    expect(sqlOf()).toContain("(COALESCE(locale, '') ILIKE 'en%') = false");
  });

  it('the report crons exist once per region', () => {
    (cron.schedule as jest.Mock).mockClear();
    startScheduler();
    const exprs = (cron.schedule as jest.Mock).mock.calls.map(c => c[0]);
    // Israel: fixed UTC times. US: collection at 09:30 UTC, then an hourly send job.
    for (const e of ['0 10 * * *', '30 10 * * 0', '0 11 1 * *', '30 9 * * *', '0 * * * *']) {
      expect(exprs).toContain(e);
    }
  });

  it('US reports go to the businesses whose local time is 9am (Sunday for weekly, the 1st for monthly)', async () => {
    bpFindMany.mockResolvedValue([]);
    await runAgentForAll('GenerateDailyReport', jest.fn(), {}, 'US', 'daily');
    expect(sqlOf()).toContain('EXTRACT(HOUR FROM');
    expect(sqlOf()).toContain(') = 9');
    expect(sqlOf()).not.toContain('EXTRACT(DOW');
    await runAgentForAll('GenerateWeeklyReport', jest.fn(), {}, 'US', 'weekly');
    expect(sqlOf()).toMatch(/EXTRACT\(DOW FROM .*\) = 0/);
    await runAgentForAll('GenerateMonthlyReport', jest.fn(), {}, 'US', 'monthly');
    expect(sqlOf()).toMatch(/EXTRACT\(DAY FROM .*\) = 1/);
    await runAgentForAll('GenerateDailyReport', jest.fn(), {}, 'IL');
    expect(sqlOf()).not.toContain('EXTRACT(HOUR');
  });
});

describe('report-only businesses and the scheduler', () => {
  const sqlOf = () => String(bpFindMany.mock.calls[bpFindMany.mock.calls.length - 1][0]);
  const EXCLUDES = "NOT LIKE 'brief\\_%'";

  it('agents outside the report pipeline skip report-only businesses', async () => {
    bpFindMany.mockResolvedValue([]);
    await runAgentForAll('FindSocialLeads', jest.fn());
    expect(sqlOf()).toContain(EXCLUDES);
    await runAgentForAll('Test', jest.fn(), {}, 'US');
    expect(sqlOf()).toContain(EXCLUDES);
  });

  it('report collectors and the reports include them', async () => {
    bpFindMany.mockResolvedValue([]);
    for (const label of ['CollectReviews', 'CollectCompetitorSocialProfileAndPosts', 'DetectCompetitorAds', 'DiffCompetitorSnapshot', 'GenerateDailyReport', 'GenerateMonthlyReport']) {
      await runAgentForAll(label, jest.fn(), {}, 'US');
      expect(sqlOf()).not.toContain(EXCLUDES);
    }
  });
});

describe('a report-only business that moved up a plan', () => {
  const bodies = (fn: unknown) => (fn as jest.Mock).mock.calls.map((c: any[]) => c[0].body);
  beforeEach(() => jest.clearAllMocks());

  it('gets its own pages and stories collected, then every report of the new plan, forced', async () => {
    bpFindMany.mockResolvedValue([{ id: 'b1', subscription_plan: 'brief_weekly' }]);
    (collectOwnSocialProfileAndPosts as jest.Mock).mockRejectedValue(new Error('apify down')); // must not stop the reports
    await upgradedBriefingReports();
    expect(bpFindMany.mock.calls[0][0]).toMatch(/SET plan_reports_due = NULL[\s\S]*RETURNING/); // claimed once
    expect(bodies(collectOwnSocialProfileAndPosts)).toEqual([{ businessProfileId: 'b1', force: true }]);
    expect(bodies(collectCompetitorSocialStories)).toEqual([{ businessProfileId: 'b1', force: true }]);
    expect(bodies(generateReport)).toEqual([
      { businessProfileId: 'b1', force: true, type: 'weekly', scheduled: true },
      { businessProfileId: 'b1', force: true, type: 'monthly', scheduled: true },
    ]);
  });

  it('does nothing for a business that is no longer on a report-only plan', async () => {
    bpFindMany.mockResolvedValue([{ id: 'b2', subscription_plan: 'starter' }]);
    await upgradedBriefingReports();
    expect(generateReport).not.toHaveBeenCalled();
  });
});
