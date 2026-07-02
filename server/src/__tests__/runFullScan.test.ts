import { Request, Response } from 'express';
import { runFullScan } from '../routes/functions/runFullScan';
import { prisma } from '../db';
import { writeAutomationLog } from '../lib/automationLog';
import { analyzeInstagramComments } from '../routes/functions/analyzeInstagramComments';
import { collectWebSignals } from '../routes/functions/collectWebSignals';
import { collectSocialSignals } from '../routes/functions/collectSocialSignals';
import { collectReviews } from '../routes/functions/collectReviews';
import { learnFromWebsite } from '../routes/functions/stubs';

// ── DB & infrastructure ───────────────────────────────────────────────────────
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    automationLog:   { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    businessMemory:  { findFirst: jest.fn() },
  },
}));
jest.mock('../lib/automationLog',         () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/bootstrapIntelligence', () => ({ bootstrapBusinessIntelligence: jest.fn() }));

// ── Collectors — all default to ok ───────────────────────────────────────────
jest.mock('../routes/functions/cleanupInsights',             () => ({ cleanupInsights:            jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/collectWebSignals',           () => ({ collectWebSignals:          jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/collectSocialSignals',        () => ({ collectSocialSignals:       jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/analyzeInstagramComments',    () => ({ analyzeInstagramComments:   jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/analyzeSocialComments',       () => ({ analyzeSocialComments:      jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/analyzeTikTokContent',        () => ({ analyzeTikTokContent:       jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/collectReviews',              () => ({ collectReviews:             jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/runMarketIntelligence',       () => ({ runMarketIntelligence:      jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/runCompetitorIdentification', () => ({ runCompetitorIdentification: jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/runLeadGeneration',           () => ({ runLeadGeneration:          jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/findSocialLeads',             () => ({ findSocialLeads:            jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/findLocalEvents',             () => ({ findLocalEvents:            jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/tiktokSectorTrendAgent',      () => ({ tiktokSectorTrendAgent:     jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/detectTrends',                () => ({ detectTrends:               jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/detectEarlyTrends',           () => ({ detectEarlyTrends:          jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/detectViralSignals',          () => ({ detectViralSignals:         jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/marketMemoryEngine',          () => ({ marketMemoryEngine:         jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/microMomentDetector',         () => ({ microMomentDetector:        jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/sentimentVelocityMonitor',    () => ({ sentimentVelocityMonitor:   jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/runPredictions',              () => ({ runPredictions:             jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/updateLeadFreshness',         () => ({ updateLeadFreshness:        jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/generateProactiveAlerts',     () => ({ generateProactiveAlerts:    jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/generateAdvisoryInsights',    () => ({ generateAdvisoryInsights:   jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/learnFromClosedDeals',        () => ({ runMLLearning:              jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/runMLLearningCycle',          () => ({ runMLLearningCycle:         jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/calculateHealthScore',        () => ({ calculateHealthScore:       jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/cleanupAndLearn',             () => ({ cleanupAndLearn:            jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/updateSectorKnowledge',       () => ({ updateSectorKnowledge:      jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/contentPerformanceAgent',     () => ({ contentPerformanceAgent:    jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/reviewRequestTimingAgent',    () => ({ reviewRequestTimingAgent:   jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/generateMorningBriefing',     () => ({ generateMorningBriefing:    jest.fn((_r: any, res: any) => res.json({ ok: true })) }));
jest.mock('../routes/functions/stubs',                       () => ({ learnFromWebsite:           jest.fn((_r: any, res: any) => res.json({ ok: true })) }));

// ── Shared fixtures ───────────────────────────────────────────────────────────
const PROFILE = { id: 'bp1', name: 'Test Biz', sector_profile: 'x', agent_missions: 'x', website_url: null };

function makeRes() {
  let snapshot: any = null;
  const json = jest.fn().mockImplementation((data: any) => {
    snapshot = JSON.parse(JSON.stringify(data));
  });
  const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;
  return { res, json, getSnapshot: () => snapshot };
}

function makeReq(id = 'bp1') {
  return { body: { businessProfileId: id } } as Request;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('runFullScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]);
    (prisma.automationLog.findFirst  as jest.Mock).mockResolvedValue(null);
    (prisma.automationLog.count      as jest.Mock).mockResolvedValue(0);
    (prisma.businessMemory.findFirst as jest.Mock).mockResolvedValue(null);
    (writeAutomationLog              as jest.Mock).mockResolvedValue(undefined);
  });

  // AC1 — sync-first: response carries only the 3 immediate results
  it('AC1: responds immediately with the first 3 results before deferred collectors run', async () => {
    const { res, json, getSnapshot } = makeRes();
    await runFullScan(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    const snap = getSnapshot();
    expect(snap.success).toBe(true);
    expect(Object.keys(snap.results)).toHaveLength(3);
    expect(snap.results).toHaveProperty('cleanupInsights');
    expect(snap.results).toHaveProperty('collectWebSignals');
    expect(snap.results).toHaveProperty('collectSocialSignals');
  });

  // AC2 — cooldown: scan ran < 24h ago → skip with cooldown flag
  it('AC2: returns cooldown response when a scan ran within the last 24h', async () => {
    (prisma.automationLog.findFirst as jest.Mock).mockResolvedValue({
      created_date: new Date(),
      automation_name: 'runFullScan',
    });
    const { res, json } = makeRes();
    await runFullScan(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0]).toMatchObject({ success: false, cooldown: true });
  });

  // AC2 — plan limit: scans_per_month exhausted → blocked
  it('AC2a: blocks scan when plan limit is exhausted', async () => {
    const profile = { ...PROFILE, plan_id: 'free_trial' };
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([profile]);
    (prisma.automationLog.count      as jest.Mock).mockResolvedValue(1); // limit is 1

    const { res, json } = makeRes();
    await runFullScan(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0]).toMatchObject({ success: false, plan_limit: true, plan: 'free_trial', scans_used: 1, scans_allowed: 1 });
  });

  it('AC2b: allows scan when under plan limit', async () => {
    const profile = { ...PROFILE, plan_id: 'starter' };
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([profile]);
    (prisma.automationLog.count      as jest.Mock).mockResolvedValue(3); // limit is 4

    const { res, json, getSnapshot } = makeRes();
    await runFullScan(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    expect(getSnapshot().success).toBe(true);
  });

  it('AC2c: pro plan bypasses scan limit entirely', async () => {
    const profile = { ...PROFILE, plan_id: 'pro' };
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([profile]);
    // count should never be called for Infinity plans
    const countMock = prisma.automationLog.count as jest.Mock;

    const { res, json, getSnapshot } = makeRes();
    await runFullScan(makeReq(), res);

    expect(json).toHaveBeenCalledTimes(1);
    expect(getSnapshot().success).toBe(true);
    expect(countMock).not.toHaveBeenCalled();
  });

  // AC3 — deferred failure: logged, does not corrupt the already-sent response
  it('AC3: logs a deferred collector error without corrupting the sent response', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Make the first deferred collector (analyzeInstagramComments) throw asynchronously
    (analyzeInstagramComments as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('api failure');
    });

    const { res, json, getSnapshot } = makeRes();
    await runFullScan(makeReq(), res);

    // Response was already sent — success: true, only the 3 immediate results
    expect(json).toHaveBeenCalledTimes(1);
    expect(getSnapshot().success).toBe(true);

    // Drain the background IIFE so the deferred collector error fires
    await new Promise(r => setTimeout(r, 50));

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[runFullScan] collector error'),
      'api failure',
    );

    errSpy.mockRestore();
  });
});

// ── KAN-34: §2.1 collection status written to AutomationLog after background pipeline ──
describe('runFullScan — KAN-34 collection status (§2.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]);
    (prisma.automationLog.findFirst  as jest.Mock).mockResolvedValue(null);
    (prisma.automationLog.count      as jest.Mock).mockResolvedValue(0);
    (prisma.businessMemory.findFirst as jest.Mock).mockResolvedValue(null);
    (writeAutomationLog              as jest.Mock).mockResolvedValue(undefined);
  });

  it('AC1: web signals collected → collection_status:succeeded written to AutomationLog', async () => {
    (collectWebSignals    as jest.Mock).mockImplementationOnce((_r: any, res: any) => res.json({ new_signals: 3 }));
    (collectSocialSignals as jest.Mock).mockImplementationOnce((_r: any, res: any) => res.json({ new_signals: 1 }));

    const { res } = makeRes();
    await runFullScan(makeReq(), res);
    await new Promise(r => setTimeout(r, 50)); // drain background IIFE

    expect(writeAutomationLog).toHaveBeenCalledWith(
      'runFullScan:collectionStatus', 'bp1', expect.any(String),
      4, 'success', 'collection_status:succeeded',
    );
  });

  it('AC2: GMB connected + Tavily returns nothing → collection_status:succeeded', async () => {
    (collectWebSignals as jest.Mock).mockImplementationOnce((_r: any, res: any) => res.json({ new_signals: 0 }));
    (collectReviews   as jest.Mock).mockImplementationOnce((_r: any, res: any) =>
      res.json({ new_reviews: 0, google_reviews_added: 0, gmb_path: 'success' }));

    const { res } = makeRes();
    await runFullScan(makeReq(), res);
    await new Promise(r => setTimeout(r, 50));

    expect(writeAutomationLog).toHaveBeenCalledWith(
      'runFullScan:collectionStatus', 'bp1', expect.any(String),
      0, 'success', 'collection_status:succeeded',
    );
  });

  it('AC3: all collectors return 0 → collection_status:not_yet_done, not false success', async () => {
    // Default mocks all return { ok: true } → new_signals / new_reviews undefined → 0
    const { res } = makeRes();
    await runFullScan(makeReq(), res);
    await new Promise(r => setTimeout(r, 50));

    expect(writeAutomationLog).toHaveBeenCalledWith(
      'runFullScan:collectionStatus', 'bp1', expect.any(String),
      0, 'success', 'collection_status:not_yet_done',
    );
  });
});

// ── KAN-38: onboarding branch — website vs no-website ────────────────────────
describe('runFullScan — KAN-38 onboarding website branch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.automationLog.findFirst  as jest.Mock).mockResolvedValue(null);
    (prisma.automationLog.count      as jest.Mock).mockResolvedValue(0);
    (prisma.businessMemory.findFirst as jest.Mock).mockResolvedValue(null);
    (writeAutomationLog              as jest.Mock).mockResolvedValue(undefined);
  });

  // AC1: business has website_url → learnFromWebsite fires (fire-and-forget, before pipeline)
  it('AC1: calls learnFromWebsite with website_url when profile has one', async () => {
    const profile = { ...PROFILE, website_url: 'https://example.com' };
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([profile]);

    const { res } = makeRes();
    await runFullScan(makeReq(), res);
    await new Promise(r => setTimeout(r, 50));

    expect(learnFromWebsite as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ businessProfileId: 'bp1', websiteUrl: 'https://example.com' }) }),
      expect.anything(),
    );
    expect(collectWebSignals as jest.Mock).toHaveBeenCalled();
  });

  // AC2: no website_url → learnFromWebsite skipped, web/social collectors still run
  it('AC2: skips learnFromWebsite and still runs collectWebSignals when no website_url', async () => {
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]); // website_url: null

    const { res } = makeRes();
    await runFullScan(makeReq(), res);
    await new Promise(r => setTimeout(r, 50));

    expect(learnFromWebsite as jest.Mock).not.toHaveBeenCalled();
    expect(collectWebSignals    as jest.Mock).toHaveBeenCalled();
    expect(collectSocialSignals as jest.Mock).toHaveBeenCalled();
  });
});
