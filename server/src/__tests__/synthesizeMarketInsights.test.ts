/**
 * Unit tests — synthesizeMarketInsights route handler (KAN-60)
 *
 * AC1: direct invocation exercises the handler end-to-end
 * AC2: runMarketIntelligence (route alias) === synthesizeMarketInsights
 * AC3: handler writes to prisma.marketSignal (behavioral distinction from runIntelligenceEngines)
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    rawSignal:       { findMany: jest.fn() },
    competitor:      { findMany: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/llm',           () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLogDual: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/eventBus',      () => ({ publishEvent: jest.fn() }));
jest.mock('../lib/sectorPrompts', () => ({ getSectorContentStrategy: jest.fn().mockReturnValue('') }));
jest.mock('../lib/sectorContext', () => ({ getSectorContext: jest.fn().mockResolvedValue('') }));
jest.mock('../lib/businessProfile', () => ({
  buildAgentPromptContext: jest.fn().mockReturnValue(''),
  isSignalRelevant:        jest.fn().mockReturnValue(true),
}));

import { synthesizeMarketInsights, runMarketIntelligence } from '../routes/functions/synthesizeMarketInsights';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { publishEvent } from '../lib/eventBus';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROFILE = { id: 'biz_001', name: 'Test Biz', category: 'restaurant', city: 'Tel Aviv', plan_id: null, relevant_services: null };

function makeReq(id = 'biz_001') {
  return { body: { businessProfileId: id } } as any;
}

function makeRes() {
  const json   = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]);
  (prisma.rawSignal.findMany       as jest.Mock).mockResolvedValue([]);   // forces cold-start path
  (prisma.competitor.findMany      as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.findMany    as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create      as jest.Mock).mockResolvedValue({});
  (invokeLLM                       as jest.Mock).mockResolvedValue({ insights: [] });
  (publishEvent                    as jest.Mock).mockResolvedValue(undefined);
});

// ─── AC1 — direct invocation ──────────────────────────────────────────────────

describe('synthesizeMarketInsights — AC1 direct invocation', () => {
  test('responds with json', async () => {
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when businessProfileId is missing', async () => {
    const res = makeRes();
    await synthesizeMarketInsights({ body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when profile not found', async () => {
    (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── AC3 — writes to MarketSignal ─────────────────────────────────────────────

describe('synthesizeMarketInsights — AC3 writes to MarketSignal', () => {
  test('calls prisma.marketSignal.create for each new insight', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Insight A', impact_level: 'high', category: 'opportunity', recommended_action: 'פרסם', confidence: 75 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
  });

  test('source_description is valid JSON', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Insight JSON', impact_level: 'high', category: 'opportunity', recommended_action: 'פרסם', confidence: 75, action_label: 'פרסם עכשיו', action_type: 'social_post', action_platform: 'instagram', prefilled_text: 'טקסט', time_minutes: 15 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    const createCall = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0];
    expect(() => JSON.parse(createCall.data.source_description)).not.toThrow();
    const parsed = JSON.parse(createCall.data.source_description);
    expect(parsed).toMatchObject({ action_type: 'social_post', action_platform: 'instagram' });
  });

  test('response includes insights_generated count', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Insight B', impact_level: 'medium', category: 'trend', recommended_action: 'שלח', confidence: 80 }],
    });
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insights_generated: 1 }));
  });

  test('skips duplicate summaries already in marketSignal', async () => {
    (prisma.marketSignal.findMany as jest.Mock).mockResolvedValue([{ summary: 'Already exists' }]);
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Already exists', impact_level: 'high', category: 'opportunity', recommended_action: 'Do X', confidence: 70 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
  });

  test('skips insights with confidence < 40', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Low confidence', impact_level: 'low', category: 'trend', recommended_action: 'Do Y', confidence: 39 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
  });
});

// ─── AC2 — route alias ────────────────────────────────────────────────────────

describe('runMarketIntelligence (route alias) — AC2', () => {
  test('is identical reference to synthesizeMarketInsights', () => {
    expect(runMarketIntelligence).toBe(synthesizeMarketInsights);
  });
});

// ─── AC4 — cold-start response shape ─────────────────────────────────────────

describe('synthesizeMarketInsights — AC4 cold-start response shape', () => {
  test('cold-start response includes cold_start: true and duplicates_skipped: 0', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Cold insight', impact_level: 'medium', category: 'opportunity', recommended_action: 'פרסם', confidence: 70 }],
    });
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      cold_start: true,
      signals_processed: 0,
      duplicates_skipped: 0,
    }));
  });

  test('cold-start produces 4-5 sector insights when LLM returns them', async () => {
    const coldInsights = Array.from({ length: 4 }, (_, i) => ({
      summary: `Cold sector insight ${i + 1}`,
      impact_level: 'medium',
      category: 'opportunity',
      recommended_action: 'פרסם',
      confidence: 70,
    }));
    (invokeLLM as jest.Mock).mockResolvedValue({ insights: coldInsights });
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    const call = (res.json as jest.Mock).mock.calls[0][0];
    expect(call.cold_start).toBe(true);
    expect(call.insights_generated).toBeGreaterThanOrEqual(4);
    expect(call.insights_generated).toBeLessThanOrEqual(5);
  });
});

// ─── AC5 — publishEvent on both paths ────────────────────────────────────────

describe('synthesizeMarketInsights — AC5 publishEvent', () => {
  test('publishes market_signal event on cold-start path when insights created', async () => {
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Cold signal event', impact_level: 'high', category: 'opportunity', recommended_action: 'פרסם', confidence: 75 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'market_signal' }));
  });

  test('publishes market_signal event on normal path when insights created', async () => {
    const recentSignal = { id: 's1', content: 'trend', category: 'trend', detected_at: new Date().toISOString(), created_date: new Date().toISOString() };
    (prisma.rawSignal.findMany as jest.Mock).mockResolvedValue([recentSignal]);
    (invokeLLM as jest.Mock).mockResolvedValue({
      insights: [{ summary: 'Normal signal event', impact_level: 'high', category: 'opportunity', recommended_action: 'שלח', confidence: 75 }],
    });
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'market_signal' }));
  });

  test('does NOT publish event when no insights created', async () => {
    // invokeLLM returns empty insights — nothing created
    await synthesizeMarketInsights(makeReq(), makeRes());
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

// ─── AC2 (signal filtering) — tier-2 fallback ────────────────────────────────

describe('synthesizeMarketInsights — AC2 tier fallback', () => {
  test('uses tier-2 (7d) signals when no signals within 48h', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600000).toISOString();
    const oldSignal = { id: 's_old', content: 'trend data', category: 'trend', detected_at: fiveDaysAgo, created_date: fiveDaysAgo };
    (prisma.rawSignal.findMany as jest.Mock).mockResolvedValue([oldSignal]);
    (invokeLLM as jest.Mock).mockResolvedValue({ insights: [] });
    const res = makeRes();
    await synthesizeMarketInsights(makeReq(), res);
    // Tier-2 fires: signal is used, so NOT cold-start path
    expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ cold_start: true }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ signals_processed: 1 }));
  });
});
