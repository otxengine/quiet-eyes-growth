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

jest.mock('../routes/functions/enrichCompetitorUrls', () => ({
  enrichCompetitorUrls: jest.fn().mockResolvedValue({ enriched: 0, skipped: 0 }),
}));

jest.mock('../lib/googlePlaces', () => ({
  getPlaceDetails: jest.fn().mockResolvedValue({
    reviews: [], editorialSummary: '', types: [], priceLevel: null,
    servesWine: false, servesBeer: false, servesVegetarianFood: false, websiteUri: '',
  }),
}));

import { runCompetitorIdentification } from '../routes/functions/runCompetitorIdentification';
import { prisma }           from '../db';
import { invokeLLM }        from '../lib/llm';
import { publishEvent }     from '../lib/eventBus';
import { writeAutomationLog } from '../lib/automationLog';
import { searchCompetitorsByKeyword } from '../lib/dataforseo';
import { enrichCompetitorUrls } from '../routes/functions/enrichCompetitorUrls';
import { getPlaceDetails } from '../lib/googlePlaces';

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

// ─── AC5 — missing GOOGLE key: warn + no crash ───────────────────────────────
// SERPAPI and TAVILY are removed from this path (KAN-213 AC1)

test('AC5: no SERPAPI/TAVILY warnings — those providers are removed from this path', async () => {
  // testEnv.ts always sets a dummy GOOGLE_PLACES_API_KEY for the whole suite, so the
  // "missing key" branch itself isn't reachable here — this asserts the removed
  // providers (KAN-213 AC1) stay gone and the soft-fail path doesn't crash.
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: [], nearby_cities: [] });

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('SERPAPI_KEY missing'));
  expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('TAVILY_API_KEY missing'));
  expect(res.status).not.toHaveBeenCalledWith(500);
  warnSpy.mockRestore();
});

// ─── KAN-213 AC7 — no-invent on empty merge ───────────────────────────────────

test('AC7: soft-fails to empty when no Maps candidates found (no second LLM call)', async () => {
  // No geocoding, no Places results → empty contextBlock → should not call LLM for filter
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] });
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(invokeLLM).toHaveBeenCalledTimes(1); // only the Haiku context call
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skipped: 'no_candidates', competitors_found: 0 }));
});

test('AC7: LLM prompt forbids invention when candidates exist', async () => {
  (global as any).fetch = geoAndPlacesFetch([
    { name: 'קפה A', place_id: 'p1', rating: 4, user_ratings_total: 10, formatted_address: 'תל אביב' },
  ]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 });
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  const sonnetCall = (invokeLLM as jest.Mock).mock.calls[1][0];
  expect(sonnetCall.prompt).not.toContain('complete from your knowledge');
  expect(sonnetCall.prompt).toContain('do NOT invent');
});

// ─── KAN-213 AC8b — website_url persistence ──────────────────────────────────

test('AC8b: sets website_url on create from DataForSEO url', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה B', place_id: 'p2', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.2, votes_count: 20,
    category: '', additional_categories: [],
    url: 'https://cafeb.co.il', domain: 'cafeb.co.il',
  }], costUsd: 0.002 });
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה B', address: 'תל אביב', rating: 4.2, review_count: 20, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ website_url: 'https://cafeb.co.il' }) })
  );
});

test('AC8b: does not overwrite existing website_url on update', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה C', place_id: 'p3', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.0, votes_count: 5,
    category: '', additional_categories: [],
    url: 'https://newurl.co.il', domain: 'newurl.co.il',
  }], costUsd: 0 });
  const existingWithUrl = { id: 'comp_c', name: 'קפה C', address: 'תל אביב', website_url: 'https://existing.co.il', not_relevant: false };
  (prisma.competitor.findMany as jest.Mock)
    .mockResolvedValueOnce([existingWithUrl])
    .mockResolvedValueOnce([existingWithUrl]);
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה C', address: 'תל אביב', rating: 4.0, review_count: 5, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  const updateCall = (prisma.competitor.update as jest.Mock).mock.calls[0][0];
  expect(updateCall.data.website_url).toBeUndefined(); // must NOT overwrite
});

test('AC8b (social fallback): DataForSEO url pointing at Instagram populates instagram_url, not website_url', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה D', place_id: 'p4', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.1, votes_count: 8,
    category: '', additional_categories: [],
    url: 'https://instagram.com/cafed', domain: undefined,
  }], costUsd: 0 });
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה D', address: 'תל אביב', rating: 4.1, review_count: 8, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({
      website_url: undefined,
      instagram_url: 'https://instagram.com/cafed',
    }) })
  );
});

test('website fallback: no DataForSEO url/domain but has place_id → falls back to Google Place Details', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה E', place_id: 'p5', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.3, votes_count: 12,
    category: '', additional_categories: [],
    url: undefined, domain: undefined,
  }], costUsd: 0 });
  (getPlaceDetails as jest.Mock).mockResolvedValueOnce({
    reviews: [], editorialSummary: '', types: [], priceLevel: null,
    servesWine: false, servesBeer: false, servesVegetarianFood: false,
    websiteUri: 'https://cafee.co.il',
  });
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה E', address: 'תל אביב', rating: 4.3, review_count: 12, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(getPlaceDetails).toHaveBeenCalledWith('p5');
  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ website_url: 'https://cafee.co.il' }) })
  );
});

test('fuzzy name match: LLM-paraphrased name still resolves a Maps candidate and derives its website', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה פלוני בע"מ', place_id: 'p6', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.0, votes_count: 3,
    category: '', additional_categories: [],
    url: 'https://ploni.co.il', domain: 'ploni.co.il',
  }], costUsd: 0 });
  // LLM drops the "בע"מ" (Ltd.) suffix present in the Maps candidate's name.
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה פלוני', address: 'תל אביב', rating: 4.0, review_count: 3, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({
      website_url: 'https://ploni.co.il',
      google_place_id: 'p6',
    }) })
  );
});

test('accepts a bare array from the selection LLM (not wrapped in {competitors: [...]})', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה F', place_id: 'p7', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.4, votes_count: 9,
    category: '', additional_categories: [],
    url: 'https://cafef.co.il', domain: 'cafef.co.il',
  }], costUsd: 0 });
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    // Sonnet returns a bare array instead of { competitors: [...] } — must not be dropped.
    .mockResolvedValueOnce([{ name: 'קפה F', address: 'תל אביב', rating: 4.4, review_count: 9, strengths: '', weaknesses: '', price_range: '', source_urls: [] }]);

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ competitors_found: 1, new_competitors_created: 1 }));
  expect(prisma.competitor.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ name: 'קפה F' }) })
  );
});

// ─── KAN-219 AC0 — enrichCompetitorUrls runs inline, same request ────────────

test('AC0: enrichCompetitorUrls runs inline for the updated competitor id, not deferred', async () => {
  (global as any).fetch = geoAndPlacesFetch([]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [{
    name: 'קפה C', place_id: 'p3', address: 'תל אביב', address_info: {},
    latitude: 32.08, longitude: 34.78, rating: 4.0, votes_count: 5,
    category: '', additional_categories: [],
    url: 'https://newurl.co.il', domain: 'newurl.co.il',
  }], costUsd: 0 });
  const existingWithUrl = { id: 'comp_c', name: 'קפה C', address: 'תל אביב', website_url: 'https://existing.co.il', not_relevant: false };
  (prisma.competitor.findMany as jest.Mock)
    .mockResolvedValueOnce([existingWithUrl])
    .mockResolvedValueOnce([existingWithUrl]);
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: ['בית קפה'], nearby_cities: [] })
    .mockResolvedValueOnce({ competitors: [{ name: 'קפה C', address: 'תל אביב', rating: 4.0, review_count: 5, strengths: '', weaknesses: '', price_range: '', source_urls: [] }] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(enrichCompetitorUrls).toHaveBeenCalledWith(['comp_c'], { force: undefined });
});

test('does not call enrichCompetitorUrls when no competitor was created or updated', async () => {
  // Empty search terms → soft-fails before any Maps/LLM-filter call (AC4 in KAN-211) —
  // only the one context invokeLLM call happens.
  (invokeLLM as jest.Mock)
    .mockResolvedValueOnce({ business_type: 'בית קפה', search_terms: [], nearby_cities: [] });

  const res = makeRes();
  await runCompetitorIdentification(makeReq(), res);

  expect(enrichCompetitorUrls).not.toHaveBeenCalled();
});

// ─── AC2 + AC4 — happy path: new competitor created, event fired ──────────────

test('AC2+AC4: creates new competitor and publishes competitor_change event', async () => {
  // Need a Maps candidate so contextBlock is non-empty (AC7 requires candidates)
  (global as any).fetch = geoAndPlacesFetch([
    { name: 'Cafe B', place_id: 'pb1', rating: 4.5, user_ratings_total: 50, formatted_address: 'תל אביב' },
  ]);
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 });
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
  expect(writeAutomationLog).toHaveBeenCalledWith('runCompetitorIdentification', 'biz_1', expect.any(String), 1, 'success', undefined, 0);
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
// Need a Maps candidate to pass AC7 check; LLM returns empty → only cleanup runs.

test('AC3: deletes competitor whose address is outside all scanned areas', async () => {
  // geoAndPlacesFetch returns the same coords for every geocode call — need the cleanup
  // pass to geocode the far-away competitor to a genuinely distant point.
  const FAR_COORDS = { lat: 29.55, lng: 34.95 }; // Eilat — ~300km from Tel Aviv
  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('geocode')) {
      const loc = url.includes(encodeURIComponent('אילת')) ? FAR_COORDS : COORDS;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ geometry: { location: loc } }] }) });
    }
    if (url.includes('nearbysearch')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [
        { name: 'Some Local', place_id: 'sl1', rating: 4, user_ratings_total: 2, formatted_address: 'תל אביב' },
      ] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
  });
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 });
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
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 });
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
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [], costUsd: 0 }); // soft-fail / empty source

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
  (searchCompetitorsByKeyword as jest.Mock).mockResolvedValue({ candidates: [
    {
      name: 'קפה ורד', place_id: 'place_1', address: 'תל אביב', address_info: {},
      latitude: 32.1, longitude: 34.8, rating: 4.3, votes_count: 12,
      category: '', additional_categories: [],
    },
  ], costUsd: 0.003 });
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
