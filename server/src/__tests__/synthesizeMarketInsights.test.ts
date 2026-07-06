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
