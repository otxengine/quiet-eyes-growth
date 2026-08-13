/**
 * Tests for detectEarlyTrends — KAN-75
 * AC1: only emerging/early_growing stages saved
 * AC2: MarketSignal category=early_trend, source_description contains velocity+days_to_peak
 * AC3: 12h cooldown returns ran_recently (not a failure)
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
    automationLog:   { findFirst: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/llm',             () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',   () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/tavily',          () => ({ tavilyAdvancedSearch: jest.fn() }));
jest.mock('../lib/businessContext', () => ({
  loadBusinessContext:    jest.fn(),
  formatContextForPrompt: jest.fn(),
}));

import { detectEarlyTrends } from '../routes/functions/detectEarlyTrends';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { tavilyAdvancedSearch } from '../lib/tavily';
import { loadBusinessContext, formatContextForPrompt } from '../lib/businessContext';

const PROFILE = {
  id: 'biz_001', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב', relevant_services: 'פיצה,פסטה', subscription_plan: 'growth',
};

function makeReq(id = 'biz_001') { return { body: { businessProfileId: id } } as any; }
function makeRes() {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

function makeTrend(overrides = {}) {
  return {
    name: 'טרנד בדיקה', stage: 'emerging', evidence: 'https://example.com',
    relevance_to_business: 'high', confidence: 80, urgency: 'high',
    opportunity_text: 'פעל עכשיו', velocity_score: 75, days_to_peak_estimate: 14,
    is_global_trend: false, days_until_israel: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(PROFILE);
  (prisma.marketSignal.findMany    as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create      as jest.Mock).mockResolvedValue({});
  (prisma.automationLog.findFirst  as jest.Mock).mockResolvedValue(null); // no recent run by default
  (tavilyAdvancedSearch            as jest.Mock).mockResolvedValue([]);
  (loadBusinessContext             as jest.Mock).mockResolvedValue({ rejectedPatterns: [] });
  (formatContextForPrompt          as jest.Mock).mockReturnValue('');
  (invokeLLM                       as jest.Mock).mockResolvedValue({ trends: [] });
});

// ── AC4 — plan gating ─────────────────────────────────────────────────────────

it('AC4: skips with plan_not_eligible for free_trial', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ ...PROFILE, subscription_plan: 'free_trial' });
  const res = makeRes();
  await detectEarlyTrends(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC4: skips with plan_not_eligible for starter', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ ...PROFILE, subscription_plan: 'starter' });
  const res = makeRes();
  await detectEarlyTrends(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
});

it('AC4: growth plan proceeds past gate', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({ trends: [] });
  const res = makeRes();
  await detectEarlyTrends(makeReq(), res);
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('plan_not_eligible');
});

// ── AC3 — 12h cooldown ────────────────────────────────────────────────────────

it('AC3: returns ran_recently with 200 when within cooldown', async () => {
  // Simulate a recent run in automationLog
  (prisma.automationLog.findFirst as jest.Mock).mockResolvedValue({ id: 'log_1', created_date: new Date() });
  const res = makeRes();
  await detectEarlyTrends(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

// ── AC1 — stage filter ────────────────────────────────────────────────────────

it('AC1: saves emerging and early_growing trends, skips mainstream', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({
    trends: [
      makeTrend({ name: 'טרנד A', stage: 'mainstream' }),
      makeTrend({ name: 'טרנד B', stage: 'emerging' }),
      makeTrend({ name: 'טרנד C', stage: 'early_growing' }),
      makeTrend({ name: 'טרנד D', stage: 'declining' }),
    ],
  });
  await detectEarlyTrends(makeReq(), makeRes());
  // only B and C pass
  expect(prisma.marketSignal.create).toHaveBeenCalledTimes(2);
  const savedNames = (prisma.marketSignal.create as jest.Mock).mock.calls.map(
    c => JSON.parse(c[0].data.source_description).action_label,
  );
  expect(savedNames).toContain('פעל עכשיו');
});

it('AC1: skips trends with relevance_to_business != high', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({
    trends: [
      makeTrend({ stage: 'emerging', relevance_to_business: 'medium' }),
    ],
  });
  await detectEarlyTrends(makeReq(), makeRes());
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

// ── AC2 — MarketSignal shape ──────────────────────────────────────────────────

it('AC2: saves MarketSignal with category=early_trend and velocity+days_to_peak in source_description', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({
    trends: [makeTrend({ velocity_score: 82, days_to_peak_estimate: 21 })],
  });
  await detectEarlyTrends(makeReq(), makeRes());
  expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
  const data = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
  expect(data.category).toBe('early_trend');
  const meta = JSON.parse(data.source_description);
  expect(meta.velocity_score).toBe(82);
  expect(meta.days_to_peak).toBe(21);
  expect(meta.is_early_trend).toBe(true);
});

// ── AC4 — Global Trends badge ─────────────────────────────────────────────────

it('AC4: sets is_global_trend=true and days_until_israel when trend is flagged', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({
    trends: [makeTrend({ is_global_trend: true, days_until_israel: 28 })],
  });
  await detectEarlyTrends(makeReq(), makeRes());
  const meta = JSON.parse((prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data.source_description);
  expect(meta.is_global_trend).toBe(true);
  expect(meta.days_until_israel).toBe(28);
});
