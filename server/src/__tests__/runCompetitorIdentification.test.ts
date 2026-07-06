/**
 * Unit tests — runCompetitorIdentification (KAN-64)
 * Covers: AC2 (geocode + create/update), AC3 (radius cleanup),
 *         AC4 (competitor_change event), AC5 (missing-key degradation)
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    competitor: {
      findMany:   jest.fn(),
      create:     jest.fn().mockResolvedValue({}),
      update:     jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../lib/automationLog', () => ({
  writeAutomationLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/llm', () => ({
  invokeLLM: jest.fn(),
}));

jest.mock('../lib/eventBus', () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/businessProfile', () => ({
  buildCompetitorTerms:    jest.fn().mockReturnValue(['בית קפה']),
  buildAgentPromptContext: jest.fn().mockReturnValue('ctx'),
  getSectorProfile:        jest.fn().mockReturnValue(null),
}));

jest.mock('../lib/missionPlanner', () => ({
  getAgentMission: jest.fn().mockReturnValue(null),
}));

import { runCompetitorIdentification } from '../routes/functions/runCompetitorIdentification';
import { prisma }           from '../db';
import { invokeLLM }        from '../lib/llm';
import { publishEvent }     from '../lib/eventBus';
import { writeAutomationLog } from '../lib/automationLog';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROFILE = {
  id: 'biz_1', name: 'Cafe A', category: 'בית קפה',
  city: 'תל אביב', search_radius_km: 10, additional_cities: '',
  sector_profile: null, agent_missions: null,
};

const COMPETITOR_STUB = {
  name: 'Cafe B', address: 'תל אביב', rating: '4.5★',
  review_count: 50, strengths: 'טוב', weaknesses: 'יקר',
  price_range: 'בינוני', source_urls: [],
};

function makeReq(id = 'biz_1') {
  return { body: { businessProfileId: id } } as any;
}

function makeRes() {
  const json   = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

// Geocoding returns no coords — simplifies all distance checks to city-name fallback
const emptyGeoFetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ results: [] }),
});

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = emptyGeoFetch;
  (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([PROFILE]);
  // default: no existing competitors
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([]);
});

// ─── Basic guards ────────────────────────────────────────────────────────────

test('returns 400 when businessProfileId is missing', async () => {
  const res = makeRes();
  await runCompetitorIdentification({ body: {} } as any, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test('returns 404 when profile not found', async () => {
  (prisma.businessProfile.findMany as jest.Mock).mockResolvedValue([]);
  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(404);
});

// ─── AC5 — missing keys: warn + no crash ─────────────────────────────────────
// SERPAPI_KEY and TAVILY_API_KEY are unset in test env (testEnv.ts only sets GOOGLE key)

test('AC5: warns about missing SERPAPI and TAVILY keys without crashing', async () => {
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: [], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SERPAPI_KEY missing'));
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TAVILY_API_KEY missing'));
  expect(res.status).not.toHaveBeenCalledWith(500);
  warnSpy.mockRestore();
});

// ─── AC2 + AC4 — happy path: new competitor created, event fired ──────────────

test('AC2+AC4: creates new competitor and publishes competitor_change event', async () => {
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [COMPETITOR_STUB] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ name: 'Cafe B', linked_business: 'biz_1' }) })
  );
  expect(publishEvent).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'competitor_change', businessId: 'biz_1' })
  );
  expect(writeAutomationLog).toHaveBeenCalledWith('runCompetitorIdentification', 'biz_1', expect.any(String), 1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ new_competitors_created: 1 }));
});

test('AC4: does NOT publish event when no competitors created or updated', async () => {
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: [], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(publishEvent).not.toHaveBeenCalled();
});

// ─── AC3 — cleanup: out-of-radius competitor deleted ─────────────────────────
// With no geocoding (empty results), cleanup falls back to city-name matching.
// A competitor whose address has no match in allAreas gets deleted.

test('AC3: deletes competitor whose address is outside all scanned areas', async () => {
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: [], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const outOfRadius = { id: 'comp_eilat', name: 'Far Cafe', address: 'אילת' };
  // First findMany: existing competitors (for dedup). Second: all competitors for cleanup.
  (prisma.competitor.findMany as jest.Mock)
    .mockResolvedValueOnce([outOfRadius])  // existing — no matches to update
    .mockResolvedValueOnce([outOfRadius]); // all — for cleanup pass

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(prisma.competitor.deleteMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: { in: ['comp_eilat'] } } })
  );
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ out_of_scope_removed: 1 }));
});
