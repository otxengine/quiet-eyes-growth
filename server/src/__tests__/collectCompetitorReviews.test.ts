/**
 * KAN-121 — Competitor review ingest: scoping and read-only guards.
 * Tests the contract, not the DB: mock Prisma + Places so no network/DB needed.
 */
import { collectCompetitorReviews } from '../routes/functions/collectCompetitorReviews';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const createdRows: any[] = [];

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findFirst: jest.fn(async () => ({ id: 'biz1', city: 'תל אביב', name: 'Biz' })),
    },
    competitor: {
      findMany: jest.fn(async () => [{ id: 'comp1', name: 'Rival', google_place_id: 'places/ABC' }]),
      update:   jest.fn(async () => ({})),
    },
    review: {
      findMany: jest.fn(async () => []),
      create:   jest.fn(async (args: any) => { createdRows.push(args.data); return args.data; }),
    },
  },
}));

jest.mock('../lib/googlePlaces', () => ({
  findPlaceId:    jest.fn(async () => 'places/ABC'),
  getPlaceDetails: jest.fn(async () => ({
    reviews: [
      { text: { text: 'Great place!' }, authorAttribution: { displayName: 'Alice' }, rating: 5, publishTime: '2024-01-01T00:00:00Z' },
      { text: { text: 'Terrible service.' }, authorAttribution: { displayName: 'Bob' }, rating: 1, publishTime: '2024-01-02T00:00:00Z' },
    ],
  })),
}));

jest.mock('../lib/serpapi', () => ({
  serpGoogleMapsReviews: jest.fn(async () => []), // SERPAPI_KEY absent → returns []
  firstValidDate: jest.fn((...c: any[]) => c.find((x: any) => x && !isNaN(new Date(x).getTime())) ?? null),
}));

jest.mock('../lib/llm', () => ({
  invokeLLM: jest.fn(async () => ({ results: [] })),
}));

jest.mock('../lib/automationLog', () => ({
  writeAutomationLog: jest.fn(async () => {}),
}));

jest.mock('../lib/signalGuard', () => ({
  normReviewOrigin: jest.fn((v: string) => v),
}));

// Cross-business donor cache is covered separately in collectCompetitorReviews.donor.test.ts —
// force it to "no donor" here so these tests only exercise the own-business scrape/insert contract.
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

// ── Tests ──────────────────────────────────────────────────────────────────────

function makeReq(body: object) { return { body } as any; }
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => { createdRows.length = 0; });

test('AC4: created rows have linked_competitor set to competitor id', async () => {
  await collectCompetitorReviews(makeReq({ businessProfileId: 'biz1' }), makeRes());
  expect(createdRows.length).toBeGreaterThan(0);
  for (const row of createdRows) {
    expect(row.linked_competitor).toBe('comp1');
  }
});

test('AC3: created rows have null response_status (never enter ops inbox)', async () => {
  await collectCompetitorReviews(makeReq({ businessProfileId: 'biz1' }), makeRes());
  for (const row of createdRows) {
    expect(row.response_status).toBeNull();
  }
});

test('AC3: linked_business is still set for query scoping', async () => {
  await collectCompetitorReviews(makeReq({ businessProfileId: 'biz1' }), makeRes());
  for (const row of createdRows) {
    expect(row.linked_business).toBe('biz1');
  }
});
