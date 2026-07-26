/**
 * Unit tests — runIntelligenceEngines route handler (KAN-60 AC3)
 *
 * Asserts the behavioral distinction: this handler writes to market_insights
 * via $executeRawUnsafe, NOT to prisma.marketSignal.
 */

jest.mock('../intelligence/ContextBuilder', () => ({
  buildEnrichedContext: jest.fn(),
}));

jest.mock('../services/intelligence/MarketIntelligenceService', () => ({
  runIntelligenceEngines: jest.fn(),
}));

jest.mock('../db', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    marketSignal:      { create: jest.fn() },
  },
}));

jest.mock('../lib/automationLog', () => ({
  writeAutomationLogDual: jest.fn().mockResolvedValue(undefined),
}));

import { runIntelligenceEngines as routeHandler } from '../routes/functions/runIntelligenceEngines';
import { buildEnrichedContext }                   from '../intelligence/ContextBuilder';
import { runIntelligenceEngines as serviceFn }    from '../services/intelligence/MarketIntelligenceService';
import { prisma }                                 from '../db';
import { writeAutomationLogDual }                 from '../lib/automationLog';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CTX_STUB = { context_id: 'ctx_001', business_id: 'biz_001' } as any;

const BASE_RESULT = {
  insights:         [],
  engines_run:      ['SupplyDemandMismatchDetector'],
  duration_ms:      42,
  trust_state:      {} as any,
  churn_risk_state: {} as any,
};

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
  (buildEnrichedContext as jest.Mock).mockResolvedValue(CTX_STUB);
  (serviceFn           as jest.Mock).mockResolvedValue(BASE_RESULT);
});

// ─── AC3 — does NOT write to MarketSignal ─────────────────────────────────────

describe('runIntelligenceEngines route handler — AC3 behavioral distinction', () => {
  test('does NOT call prisma.marketSignal.create', async () => {
    await routeHandler(makeReq(), makeRes());
    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
  });

  test('calls $executeRawUnsafe when insights exist', async () => {
    (serviceFn as jest.Mock).mockResolvedValue({
      ...BASE_RESULT,
      insights: [{
        id: 'i1', type: 'supply_demand_mismatch', title: 'Test', summary: 'sum',
        urgency: 'high', confidence: 0.8,
      }],
    });
    await routeHandler(makeReq(), makeRes());
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  test('responds with ok:true and engines_run', async () => {
    const res = makeRes();
    await routeHandler(makeReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, engines_run: ['SupplyDemandMismatchDetector'] }));
  });

  test('returns 400 when businessProfileId is missing', async () => {
    const res = makeRes();
    await routeHandler({ body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('writeAutomationLogDual called after successful run (pipeline run logged)', async () => {
    await routeHandler(makeReq(), makeRes());
    expect(writeAutomationLogDual).toHaveBeenCalledWith(
      'runIntelligenceEngines',
      'runMarketIntelligence',
      'biz_001',
      expect.any(String),
      0, // BASE_RESULT has 0 insights
    );
  });

  test('market_insights written via $executeRawUnsafe, NOT marketSignal.create', async () => {
    (serviceFn as jest.Mock).mockResolvedValue({
      ...BASE_RESULT,
      insights: [{ id: 'i1', type: 'supply_demand_mismatch', title: 'T', summary: 's', urgency: 'high', confidence: 0.8 }],
    });
    await routeHandler(makeReq(), makeRes());
    expect(prisma.marketSignal.create).not.toHaveBeenCalled();
    const rawCall = (prisma.$executeRawUnsafe as jest.Mock).mock.calls[0][0] as string;
    expect(rawCall).toContain('market_insights');
  });
});
