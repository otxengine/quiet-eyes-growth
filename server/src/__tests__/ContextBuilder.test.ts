/**
 * Unit tests — ContextBuilder (KAN-65)
 *
 * AC1: reads all required sources
 * AC2: returns in-memory EnrichedContext (no DB writes)
 * AC3: missing/empty source → empty section, no hard failure
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany:   jest.fn().mockResolvedValue([]) },
    lead:            { findMany:   jest.fn().mockResolvedValue([]) },
    competitor:      { findMany:   jest.fn().mockResolvedValue([]) },
    healthScore:     { findFirst:  jest.fn().mockResolvedValue(null) },
    review:          { findMany:   jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    sectorKnowledge: { findFirst:  jest.fn().mockResolvedValue(null) },
    prediction:      { findMany:   jest.fn().mockResolvedValue([]) },
    action:          { findMany:   jest.fn().mockResolvedValue([]) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../lib/businessContext', () => ({
  loadBusinessContext: jest.fn().mockResolvedValue(null),
}));

import { buildEnrichedContext } from '../intelligence/ContextBuilder';
import { prisma }               from '../db';

const PROFILE = {
  id: 'biz_001', name: 'Test Biz', category: 'food',
  city: 'Tel Aviv', plan_id: null, description: null,
};

beforeEach(() => jest.clearAllMocks());

// ─── AC1 + AC2 — happy path ───────────────────────────────────────────────────

describe('buildEnrichedContext — happy path', () => {
  beforeEach(() => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(PROFILE);
  });

  test('returns EnrichedContext with correct business_id and profile', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.business_id).toBe('biz_001');
    expect(ctx.profile.name).toBe('Test Biz');
    expect(ctx.profile.category).toBe('food');
    expect(ctx.profile.city).toBe('Tel Aviv');
  });

  test('is in-memory only — no DB writes ($queryRawUnsafe returns only reads)', async () => {
    await buildEnrichedContext('biz_001');
    // $queryRawUnsafe is used by loadMetaConfig/loadRecentDecisions/loadRecentOutcomes (reads only)
    const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls;
    calls.forEach(([sql]: [string]) => {
      expect(sql.trim().toUpperCase()).not.toMatch(/^INSERT|^UPDATE|^DELETE/);
    });
  });

  test('aggregates empty leads correctly', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.leads).toEqual({ total: 0, hot: 0, warm: 0, new: 0, avg_score: 0 });
  });

  test('sectors with populated leads compute avg_score', async () => {
    (prisma.lead.findMany as jest.Mock).mockResolvedValue([
      { status: 'hot',  score: 80 },
      { status: 'warm', score: 60 },
      { status: 'new',  score: 40 },
    ]);
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.leads.total).toBe(3);
    expect(ctx.leads.hot).toBe(1);
    expect(ctx.leads.avg_score).toBe(60);
  });

  test('recent_decisions and recent_outcomes are arrays', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(Array.isArray(ctx.recent_decisions)).toBe(true);
    expect(Array.isArray(ctx.recent_outcomes)).toBe(true);
  });
});

// ─── AC3 — missing/empty sources ─────────────────────────────────────────────

describe('buildEnrichedContext — missing/empty sources (AC3)', () => {
  beforeEach(() => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(PROFILE);
  });

  test('missing health score → health_score is null', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.health_score).toBeNull();
  });

  test('missing sector knowledge → sector_knowledge is null', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.sector_knowledge).toBeNull();
  });

  test('missing meta_configuration → meta_configuration is null', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.meta_configuration).toBeNull();
  });

  test('missing business memory → memory is null', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.memory).toBeNull();
  });

  test('empty signals/leads/competitors → sections are empty, no throw', async () => {
    const ctx = await buildEnrichedContext('biz_001');
    expect(ctx.recent_signals).toHaveLength(0);
    expect(ctx.competitors).toHaveLength(0);
    expect(ctx.active_predictions).toHaveLength(0);
  });

  test('missing profile → returns empty context without throwing (no hard failure)', async () => {
    (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(null);
    const ctx = await buildEnrichedContext('biz_nonexistent');
    expect(ctx.business_id).toBe('biz_nonexistent');
    expect(ctx.profile).toMatchObject({ name: '', category: '', city: '' });
    expect(ctx.leads.total).toBe(0);
    expect(ctx.recent_signals).toHaveLength(0);
    expect(ctx.memory).toBeNull();
  });
});
