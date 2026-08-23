import { detectTrends } from '../routes/functions/detectTrends';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { isTavilyRateLimited } from '../lib/tavily';

jest.mock('../db', () => ({
  prisma: {
    businessProfile:  { findMany: jest.fn() },
    rawSignal:        { findMany: jest.fn() },
    marketSignal:     { findMany: jest.fn(), create: jest.fn() },
    sectorKnowledge:  { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    automationLog:    { create: jest.fn() },
  },
}));
jest.mock('../lib/llm',            () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',  () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/tavily',         () => ({
  tavilyAdvancedSearch: jest.fn().mockResolvedValue([]),
  isTavilyRateLimited:  jest.fn().mockReturnValue(false),
}));
jest.mock('../lib/dataSources',    () => ({ parseKeywords: jest.fn().mockReturnValue([]) }));
jest.mock('../lib/missionPlanner', () => ({ getAgentMission: jest.fn().mockReturnValue(null) }));
jest.mock('../lib/businessProfile', () => ({
  filterSignals:  jest.fn((sigs: any[]) => sigs),
  getSectorProfile: jest.fn().mockReturnValue(null),
}));

const PROFILE = { id: 'bp1', name: 'Test', category: 'מסעדה', city: 'Tel Aviv', subscription_plan: 'growth' };

function makeRes() {
  const res: any = {};
  res.json   = jest.fn((d: any) => { res._data = d; return res; });
  res.status = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  (isTavilyRateLimited as jest.Mock).mockReturnValue(false);
  (prisma.businessProfile.findMany  as jest.Mock).mockResolvedValue([PROFILE]);
  (prisma.rawSignal.findMany        as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.findMany     as jest.Mock).mockResolvedValue([]);
  (prisma.sectorKnowledge.findFirst as jest.Mock).mockResolvedValue(null);
  (invokeLLM as jest.Mock).mockResolvedValue({ trends: [] });
});

describe('detectTrends', () => {
  // AC3
  it('skips with reason:no_data_sources when Tavily rate-limited and SERP_API_KEY absent', async () => {
    (isTavilyRateLimited as jest.Mock).mockReturnValue(true);
    const saved = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: true, reason: 'no_data_sources' })
    );
    expect(res.status).not.toHaveBeenCalledWith(expect.anything());

    if (saved !== undefined) process.env.SERP_API_KEY = saved;
  });

  // AC2
  it('skips a trend whose summary already exists (dedup)', async () => {
    (prisma.marketSignal.findMany as jest.Mock).mockResolvedValue([{ summary: 'טרנד קיים' }]);
    (invokeLLM as jest.Mock).mockResolvedValue({
      trends: [{ trend_name: 'טרנד קיים', evidence: 'src', relevance_to_business: 'high', confidence: 70, urgency: 'medium', growth_stage: 'growing', opportunity_for_business: 'x', action_platform: 'instagram', source_type: 'web' }],
    });

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
    expect(res._data.trends_created).toBe(0);
  });

  // AC4
  it('keeps low-relevance trends but caps confidence at 40', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      trends: [{ trend_name: 'טרנד חלש', evidence: 'src', relevance_to_business: 'low', confidence: 75, urgency: 'low', growth_stage: 'emerging', opportunity_for_business: 'x', action_platform: 'instagram', source_type: 'web' }],
    });

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
    const created = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
    expect(created.confidence).toBeLessThanOrEqual(40);
    expect(res._data.trends_created).toBe(1);
  });

  // AC1 — category field on created MarketSignal
  it('writes MarketSignal with category=trend', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      trends: [{ trend_name: 'טרנד חדש', evidence: 'src', relevance_to_business: 'high', confidence: 70, urgency: 'medium', growth_stage: 'growing', opportunity_for_business: 'x', action_platform: 'instagram', source_type: 'web' }],
    });

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    const created = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
    expect(created.category).toBe('trend');
  });

  // AC4 — plan gating
  it('skips with plan_not_eligible for free_trial plan', async () => {
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([{ ...PROFILE, subscription_plan: 'free_trial' }]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' })
    );
    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
  });

  it('skips with plan_not_eligible for starter plan', async () => {
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([{ ...PROFILE, subscription_plan: 'starter' }]);

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' })
    );
  });

  it('growth plan proceeds past gate', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({ trends: [] });
    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    const call = (res.json as jest.Mock).mock.calls[0][0];
    expect(call?.reason).not.toBe('plan_not_eligible');
  });

  // AC1 — SectorKnowledge created when row missing
  it('creates SectorKnowledge row when none exists for the sector', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      trends: [{ trend_name: 'טרנד חדש', evidence: 'src', relevance_to_business: 'high', confidence: 70, urgency: 'medium', growth_stage: 'growing', opportunity_for_business: 'x', action_platform: 'instagram', source_type: 'web' }],
    });

    const req: any = { body: { businessProfileId: 'bp1' } };
    const res = makeRes();
    await detectTrends(req, res);

    expect(prisma.sectorKnowledge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sector: PROFILE.category, trending_services: 'טרנד חדש' }),
      })
    );
  });
});
