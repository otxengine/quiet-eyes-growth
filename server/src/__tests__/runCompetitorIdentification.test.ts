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
  buildCompetitorTerms:         jest.fn().mockReturnValue(['בית קפה']),
  buildIdentityCompetitorTerms: jest.fn().mockReturnValue([]),
  buildAgentPromptContext:      jest.fn().mockReturnValue('ctx'),
  getSectorProfile:             jest.fn().mockReturnValue(null),
}));

jest.mock('../lib/missionPlanner', () => ({
  getAgentMission: jest.fn().mockReturnValue(null),
}));

jest.mock('../lib/dataforseo', () => ({
  searchCompetitorsByKeyword: jest.fn(),
}));

import { runCompetitorIdentification } from '../routes/functions/runCompetitorIdentification';
import { prisma }           from '../db';
import { invokeLLM }        from '../lib/llm';
import { publishEvent }     from '../lib/eventBus';
import { writeAutomationLog } from '../lib/automationLog';
import { searchCompetitorsByKeyword } from '../lib/dataforseo';

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

const COORDS = { lat: 32.08, lng: 34.78 };

// Geocoding resolves to COORDS (enables the DataForSEO leg, which requires coords) and
// Google Places nearbysearch returns `placesResults`.
function geoAndPlacesFetch(placesResults: any[] = []) {
  return jest.fn((url: string) => {
    if (url.includes('geocode')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ geometry: { location: COORDS } }] }) });
    }
    if (url.includes('nearbysearch')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: placesResults }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
  });
}

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

// ─── KAN-212: parallel DataForSEO + Places discovery, merge/dedupe ───────────

test('AC1 (KAN-212): DataForSEO Maps and Google Places nearby both run for the same term', async () => {
  const placesFetch = geoAndPlacesFetch([
    { name: 'Google Cafe', place_id: 'gp1', rating: 4, user_ratings_total: 3, formatted_address: 'תל אביב' },
  ]);
  (global as any).fetch = placesFetch;
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue([]);
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(searchCompetitorsByKeyword).toHaveBeenCalledWith('בית קפה', COORDS.lat, COORDS.lng);
  expect(placesFetch).toHaveBeenCalledWith(expect.stringContaining('nearbysearch'));
});

test('AC2 (KAN-212): DataForSEO empty/down does not block identify — Places results still used', async () => {
  (global as any).fetch = geoAndPlacesFetch([
    { name: 'Google Cafe', place_id: 'gp1', rating: 4.1, user_ratings_total: 8, formatted_address: 'תל אביב' },
  ]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue([]); // soft-fail / empty source

  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  const sonnetCall = (invokeLLM as jest.Mock).mock.calls[1][0];
  expect(sonnetCall.prompt).toContain('Google Cafe');
  expect(res.status).not.toHaveBeenCalledWith(500);
});

test('AC3+AC4 (KAN-212): merges candidates sharing a place_id and tags discovery_sources', async () => {
  (global as any).fetch = geoAndPlacesFetch([
    { name: 'קפה ורד', place_id: 'place_1', rating: 4.0, user_ratings_total: 5, formatted_address: 'תל אביב' },
  ]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue([
    {
      name: 'קפה ורד', place_id: 'place_1', address: 'תל אביב', address_info: {},
      latitude: 32.1, longitude: 34.8, rating: 4.3, votes_count: 12,
      category: '', additional_categories: [],
    },
  ]);
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  const provenanceLine = logSpy.mock.calls.map(c => c[0])
    .find((l: string) => typeof l === 'string' && l.startsWith('runCompetitorIdentification: discovery_sources='));
  expect(provenanceLine).toBeDefined();

  const tagged = JSON.parse(provenanceLine.replace('runCompetitorIdentification: discovery_sources=', ''));
  expect(tagged).toHaveLength(1); // deduped into one candidate by shared place_id
  expect(tagged[0].discovery_sources.sort()).toEqual(['dataforseo_maps', 'google_places']);

  logSpy.mockRestore();
});
