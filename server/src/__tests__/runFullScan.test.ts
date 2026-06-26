import { Request, Response } from 'express';
import { runFullScan } from '../routes/functions/runFullScan';
import { prisma } from '../db';
import { writeAutomationLog } from '../lib/automationLog';
import { analyzeInstagramComments } from '../routes/functions/analyzeInstagramComments';

// ── DB & infrastructure ───────────────────────────────────────────────────────
jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    automationLog:   { findFirst: jest.fn(), create: jest.fn() },
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

  // AC3 — deferred failure: logged, does not corrupt the already-sent response
  it('AC3: logs a deferred collector error without corrupting the sent response', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Make the first deferred collector (analyzeInstagramComments) throw asynchronously
    (analyzeInstagramComments as jest.Mock).mockImplementation(async () => {
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
