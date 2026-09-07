/**
 * demandGapEngine — confirms a dismissed opportunity's rejected keyword
 * actually suppresses similarly-worded gaps from being (re)created, and that
 * unrelated gaps are still created normally.
 */

import { Request, Response } from 'express';
import { demandGapEngine } from '../routes/functions/demandGapEngine';
import { prisma } from '../db';
import { loadBusinessContext } from '../lib/businessContext';
import { invokeLLM } from '../lib/llm';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    competitor:      { findMany: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
    sectorKnowledge: { findFirst: jest.fn() },
  },
}));
jest.mock('../lib/llm',             () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',   () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/businessContext', () => ({
  loadBusinessContext: jest.fn(),
  formatContextForPrompt: jest.fn(() => ''),
}));

const PROFILE = { id: 'bp1', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב' };

function makeReq() { return { body: { businessProfileId: 'bp1' } } as Request; }
function makeRes() {
  const r: any = {};
  r.json   = jest.fn().mockReturnValue(r);
  r.status = jest.fn().mockReturnValue(r);
  return r as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]);
  (prisma.competitor.findMany      as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.findMany    as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create      as jest.Mock).mockResolvedValue({});
  (prisma.sectorKnowledge.findFirst as jest.Mock).mockResolvedValue(null);
  (loadBusinessContext as jest.Mock).mockResolvedValue({ rejectedPatterns: [] });
});

test('skips a generated gap whose text matches a previously-rejected pattern', async () => {
  (loadBusinessContext as jest.Mock).mockResolvedValue({ rejectedPatterns: ['סדנאות בישול'] });
  (invokeLLM as jest.Mock).mockResolvedValue({
    gaps: [{ demand: 'ביקוש גובר לסדנאות בישול בשכונה', opportunity_score: 80, action: 'פתח סדנה' }],
  });

  const res = makeRes();
  await demandGapEngine(makeReq(), res);

  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ items_created: 0 }));
});

test('still creates a gap with no rejected-pattern match', async () => {
  (loadBusinessContext as jest.Mock).mockResolvedValue({ rejectedPatterns: ['סדנאות בישול'] });
  (invokeLLM as jest.Mock).mockResolvedValue({
    gaps: [{ demand: 'ביקוש להזמנת מקומות אונליין', opportunity_score: 90, action: 'הקם מערכת הזמנות' }],
  });

  const res = makeRes();
  await demandGapEngine(makeReq(), res);

  expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ items_created: 1 }));
});
