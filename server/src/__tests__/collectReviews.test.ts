import { Request, Response } from 'express';
import { collectReviews } from '../routes/functions/collectReviews';
import { prisma } from '../db';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { invokeLLM } from '../lib/llm';
import { tavilySearch } from '../lib/tavily';
import { writeAutomationLog } from '../lib/automationLog';
import { publishEvent } from '../lib/eventBus';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn(), update: jest.fn() },
    review:          { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
    socialAccount:   { findFirst: jest.fn() },
    competitor:      { findMany: jest.fn() },
    marketSignal:    { findFirst: jest.fn(), create: jest.fn() },
    proactiveAlert:  { findFirst: jest.fn(), create: jest.fn() },
    rawSignal:       { findMany: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/agentCache',    () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/llm',           () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/tavily',        () => ({ tavilySearch: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/eventBus',      () => ({ publishEvent: jest.fn() }));

// Mock global fetch
global.fetch = jest.fn() as jest.Mock;

const bpFindMany       = prisma.businessProfile.findMany    as jest.Mock;
const bpUpdate         = prisma.businessProfile.update      as jest.Mock;
const reviewFindMany   = prisma.review.findMany             as jest.Mock;
const reviewCreate     = prisma.review.create               as jest.Mock;
const reviewFindFirst  = prisma.review.findFirst            as jest.Mock;
const socialFindFirst  = prisma.socialAccount.findFirst     as jest.Mock;
const competitorFindMany = prisma.competitor.findMany       as jest.Mock;
const msFindFirst      = prisma.marketSignal.findFirst      as jest.Mock;
const msCreate         = prisma.marketSignal.create         as jest.Mock;
const alertFindFirst   = prisma.proactiveAlert.findFirst    as jest.Mock;
const alertCreate      = prisma.proactiveAlert.create       as jest.Mock;
const rawSignalFindMany = prisma.rawSignal.findMany         as jest.Mock;
const execRaw          = prisma.$executeRawUnsafe           as jest.Mock;
const skipAgent        = shouldSkipAgent                    as jest.Mock;
const llm              = invokeLLM                          as jest.Mock;
const tavily           = tavilySearch                       as jest.Mock;
const autoLog          = writeAutomationLog                 as jest.Mock;
const mockFetch        = global.fetch                       as jest.Mock;

const PROFILE = {
  id: 'bp1', name: 'Test Biz', city: 'תל אביב',
  google_place_id: null, google_access_token: null,
};

const GMB_ACCOUNT = {
  id: 'sa1',
  platform: 'google_business',
  is_connected: true,
  page_id: 'accounts/123/locations/456',
  access_token: 'gmb-token-abc',
  refresh_token: 'refresh-xyz',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

function gmbReview(overrides: any = {}) {
  return {
    name: 'accounts/123/locations/456/reviews/rev001',
    starRating: 'FIVE',
    comment: 'מעולה מאוד!',
    createTime: '2024-01-01T10:00:00Z',
    reviewer: { displayName: 'ישראל ישראלי' },
    reviewReply: null,
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  bpFindMany.mockResolvedValue([PROFILE]);
  bpUpdate.mockResolvedValue({});
  reviewFindMany.mockResolvedValue([]);
  reviewCreate.mockResolvedValue({ id: 'r1' });
  reviewFindFirst.mockResolvedValue(null);
  socialFindFirst.mockResolvedValue(null);
  competitorFindMany.mockResolvedValue([]);
  msFindFirst.mockResolvedValue(null);
  msCreate.mockResolvedValue({});
  alertFindFirst.mockResolvedValue(null);
  alertCreate.mockResolvedValue({});
  rawSignalFindMany.mockResolvedValue([]);
  execRaw.mockResolvedValue(undefined);
  skipAgent.mockReturnValue(false);
  (setLastRun as jest.Mock).mockReturnValue(undefined);
  llm.mockResolvedValue({ results: [] });
  tavily.mockResolvedValue([]);
  autoLog.mockResolvedValue(undefined);
  (publishEvent as jest.Mock).mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({ ok: false, status: 404, json: jest.fn().mockResolvedValue({}) });
});

// ── Input validation ───────────────────────────────────────────────────────────

describe('collectReviews — input validation', () => {
  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await collectReviews(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  test('404 when business profile not found', async () => {
    bpFindMany.mockResolvedValue([]);
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── Cooldown ───────────────────────────────────────────────────────────────────

describe('collectReviews — cooldown', () => {
  test('returns ran_recently when cooldown active and force not set', async () => {
    skipAgent.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    expect(json).toHaveBeenCalledWith({ new_reviews: 0, skipped: true, reason: 'ran_recently' });
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  test('force:true bypasses cooldown', async () => {
    skipAgent.mockReturnValue(true);
    socialFindFirst.mockResolvedValue(null);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1', force: true });
    await collectReviews(req, res);
    expect(json).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'ran_recently' }));
  });
});

// ── AC1: GMB path ──────────────────────────────────────────────────────────────

describe('collectReviews — AC1: GMB connected → reviews fetched and de-duped by google_review_id', () => {

  test('GMB reviews are fetched and written with correct fields', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: ['שירות'], sentiments: { שירות: 'positive' } }] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform:        'Google',
        rating:          5,
        google_review_id: 'accounts/123/locations/456/reviews/rev001',
        source_origin:   'google_business_api',
        is_verified:     true,
        linked_business: 'bp1',
      }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ google_reviews_added: 1 }));
  });

  test('already-seen google_review_id is de-duplicated and not inserted again', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'accounts/123/locations/456/reviews/rev001',
      text: 'מעולה מאוד!',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ google_reviews_added: 0 }));
  });

  test('paginated GMB response: fetches all pages via nextPageToken', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    const page1Review = gmbReview({ name: 'accounts/123/locations/456/reviews/rev001', comment: 'דף ראשון' });
    const page2Review = gmbReview({ name: 'accounts/123/locations/456/reviews/rev002', comment: 'דף שני' });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ reviews: [page1Review], nextPageToken: 'token-page2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ reviews: [page2Review], nextPageToken: undefined }),
      });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }, { topics: [], sentiments: {} }] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      expect.stringContaining('pageToken=token-page2'),
      expect.any(Object),
    );
    expect(reviewCreate).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ google_reviews_added: 2 }));
  });

  test('GMB 401 response: logs warning and falls through to Places path', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({ error: { message: 'Invalid Credentials' } }),
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('401'));
    expect(reviewCreate).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('malformed page_id without "/" emits warning and skips GMB path', async () => {
    socialFindFirst.mockResolvedValue({ ...GMB_ACCOUNT, page_id: 'flat-id-no-slash' });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flat-id-no-slash'));
    // GMB API must NOT have been called; Places may still run as fallback
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('mybusiness.googleapis.com'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

});

// ── AC2: Places fallback ───────────────────────────────────────────────────────

describe('collectReviews — AC2: no GMB → Places API used', () => {

  test('uses stored google_place_id to call Places Details API', async () => {
    socialFindFirst.mockResolvedValue(null);
    bpFindMany.mockResolvedValue([{ ...PROFILE, google_place_id: 'ChIJplace123' }]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        result: {
          reviews: [{
            author_name: 'דינה כהן',
            rating: 4,
            text: 'מקום יפה מאוד',
            time: 1700000000,
          }],
        },
        status: 'OK',
      }),
    });
    llm.mockResolvedValue({ results: [{ topics: ['אווירה'], sentiments: { אווירה: 'positive' } }] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('ChIJplace123'));
    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform:      'Google',
        source_origin: 'google_places',
        google_review_id: expect.stringContaining('places_דינה כהן_'),
        linked_business: 'bp1',
      }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 1 }));
  });

  test('resolves and persists place_id via findPlaceId when none stored', async () => {
    socialFindFirst.mockResolvedValue(null);
    bpFindMany.mockResolvedValue([{ ...PROFILE, google_place_id: null }]);

    // findPlaceId call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ place_id: 'ChIJresolved' }],
        status: 'OK',
      }),
    });
    // getPlaceReviews call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        result: { reviews: [] },
        status: 'OK',
      }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(bpUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ google_place_id: 'ChIJresolved', google_place_id_verified: true }),
    }));
  });

  test('Places reviews de-duplicated by synthetic google_review_id across runs', async () => {
    socialFindFirst.mockResolvedValue(null);
    bpFindMany.mockResolvedValue([{ ...PROFILE, google_place_id: 'ChIJplace123' }]);
    // Simulate existing de-dup entry
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'places_דינה כהן_1700000000',
      text: 'מקום יפה מאוד',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        result: {
          reviews: [{
            author_name: 'דינה כהן',
            rating: 4,
            text: 'מקום יפה מאוד',
            time: 1700000000,
          }],
        },
        status: 'OK',
      }),
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 0 }));
  });

});

// ── KAN-18 AC1: topics and topic_sentiment persisted ─────────────────────────

describe('collectReviews — KAN-18 AC1: topics and topic_sentiment persisted', () => {
  test('topics and topic_sentiment written to each new review', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({
      results: [{ topics: ['שירות', 'מחיר'], sentiments: { שירות: 'positive', מחיר: 'neutral' } }],
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        topics:          'שירות,מחיר',
        topic_sentiment: JSON.stringify({ שירות: 'positive', מחיר: 'neutral' }),
      }),
    }));
  });
});

// ── KAN-18 AC2: rating_history snapshot inserted ──────────────────────────────

describe('collectReviews — KAN-18 AC2: rating_history snapshot inserted', () => {
  test('INSERT INTO rating_history after new reviews are collected', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }] });
    reviewFindMany
      .mockResolvedValueOnce([])                       // dedup
      .mockResolvedValueOnce([{ rating: 5 }])          // rating_history allRatings
      .mockResolvedValueOnce([])                       // ProactiveAlert negatives
      .mockResolvedValueOnce([{ id: 'r1' }]);          // freshReviews (publishEvent)

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(execRaw).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO rating_history'),
      'bp1',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      'collectReviews',
    );
  });
});

// ── KAN-18 AC3: ProactiveAlert negative_review created ───────────────────────

describe('collectReviews — KAN-18 AC3: ProactiveAlert negative_review created', () => {
  test('creates ProactiveAlert with alert_type negative_review for new negative review', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [gmbReview({ starRating: 'ONE', comment: 'גרוע מאוד' })],
        nextPageToken: undefined,
      }),
    });
    llm.mockResolvedValue({ results: [{ topics: ['שירות'], sentiments: { שירות: 'negative' } }] });
    reviewFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ rating: 1 }])
      .mockResolvedValueOnce([{
        id: 'r1', sentiment: 'negative', rating: 1,
        reviewer_name: 'ישראל ישראלי', text: 'גרוע מאוד',
      }])
      .mockResolvedValueOnce([{ id: 'r1' }]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        alert_type:      'negative_review',
        priority:        'high',
        linked_business: 'bp1',
      }),
    }));
  });

  test('does not create duplicate ProactiveAlert when one already exists', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [gmbReview({ starRating: 'ONE', comment: 'גרוע' })],
        nextPageToken: undefined,
      }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }] });
    reviewFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ rating: 1 }])
      .mockResolvedValueOnce([{ id: 'r1', sentiment: 'negative', rating: 1, reviewer_name: 'לקוח', text: 'גרוע' }])
      .mockResolvedValueOnce([{ id: 'r1' }]);
    alertFindFirst.mockResolvedValue({ id: 'existing-alert' });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(alertCreate).not.toHaveBeenCalled();
  });
});

// ── KAN-18 AC4: new_review event published exactly once per review ────────────

describe('collectReviews — KAN-18 AC4: new_review event published per review', () => {
  test('publishEvent called once per new review with review_id', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }] });
    // discriminate by select shape so call ordering doesn't matter
    reviewFindMany.mockImplementation((opts: any) => {
      if (opts?.select?.id) return Promise.resolve([{ id: 'r1' }]);
      return Promise.resolve([]);
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(publishEvent as jest.Mock).toHaveBeenCalledTimes(1);
    expect(publishEvent as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'new_review',
      payload:   expect.objectContaining({ review_id: 'r1' }),
    }));
  });

  test('publishEvent called once per review when two new reviews added', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [
          gmbReview({ name: 'accounts/123/locations/456/reviews/rev001', comment: 'טוב' }),
          gmbReview({ name: 'accounts/123/locations/456/reviews/rev002', comment: 'מעולה' }),
        ],
        nextPageToken: undefined,
      }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }, { topics: [], sentiments: {} }] });
    reviewFindMany.mockImplementation((opts: any) => {
      if (opts?.select?.id) return Promise.resolve([{ id: 'r1' }, { id: 'r2' }]);
      return Promise.resolve([]);
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(publishEvent as jest.Mock).toHaveBeenCalledTimes(2);
    expect(publishEvent as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'new_review', payload: expect.objectContaining({ review_id: 'r1' }) }));
    expect(publishEvent as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'new_review', payload: expect.objectContaining({ review_id: 'r2' }) }));
  });

  test('publishEvent not called when no new reviews', async () => {
    socialFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(publishEvent as jest.Mock).not.toHaveBeenCalled();
  });
});

// ── KAN-17 AC: Tier 3 — Tavily direct search ──────────────────────────────────

describe('collectReviews — KAN-17 Tier 3: Tavily direct', () => {
  beforeEach(() => {
    socialFindFirst.mockResolvedValue(null);
    // Google Places returns nothing → Tier 3 eligible
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ candidates: [], status: 'ZERO_RESULTS', result: { reviews: [] } }),
    });
  });

  test('triggers when Google returns nothing and writes review with source_origin: tavily', async () => {
    tavily.mockResolvedValueOnce([
      { url: 'https://example.com/rev', content: 'ביקורת מצוינת על מסעדה טסט שירות מהיר', snippet: '' },
    ]);
    llm.mockResolvedValueOnce({
      results: [{ is_review: true, text: 'ביקורת מצוינת על מסעדה', rating: 5, reviewer_name: 'יוסי', platform: 'Google' }],
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source_origin: 'tavily', text: 'ביקורת מצוינת על מסעדה' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 1 }));
  });

  test('Tier 3 is skipped when Google Places already found reviews', async () => {
    bpFindMany.mockResolvedValue([{ ...PROFILE, google_place_id: 'ChIJ_test_id_123' }]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'OK',
        result: {
          reviews: [{
            author_name: 'ישראל ישראלי',
            text: 'מסעדה מצוינת מאוד אהבתי את האוכל',
            rating: 5,
            time: Math.floor(Date.now() / 1000) - 1000,
          }],
        },
      }),
    });
    llm.mockResolvedValueOnce({ results: [{ topics: ['שירות'], sentiments: { 'שירות': 'positive' } }] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    // Tier 3 query contains 'ביקורות' but no 'site:' — should not appear
    const tier3Call = (tavily.mock.calls as string[][]).find(([q]) => q.includes('ביקורות') && !q.includes('site:'));
    expect(tier3Call).toBeUndefined();
  });

  test('LLM-classified non-review snippets are not persisted', async () => {
    tavily.mockResolvedValueOnce([
      { url: 'https://example.com/ad', content: 'פרסומת למסעדה טסט במחיר מיוחד', snippet: '' },
    ]);
    llm.mockResolvedValueOnce({
      results: [{ is_review: false, text: 'פרסומת למסעדה', rating: 0, reviewer_name: '' }],
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 0 }));
  });
});

// ── KAN-17 AC: Tier 4 — multi-source Tavily ───────────────────────────────────

describe('collectReviews — KAN-17 Tier 4: multi-source Tavily', () => {
  beforeEach(() => {
    socialFindFirst.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ candidates: [], status: 'ZERO_RESULTS', result: { reviews: [] } }),
    });
  });

  test('triggers when Tier 3 yields nothing and writes review with correct platform label', async () => {
    // Tier 3 → empty; Tier 4 facebook (first key in SOURCE_QUERIES) → one result
    tavily
      .mockResolvedValueOnce([])  // Tier 3 direct search
      .mockResolvedValueOnce([    // Tier 4: facebook
        { url: 'https://facebook.com/review/1', content: 'מסעדה טסט אוכל מדהים ביותר', snippet: '' },
      ])
      .mockResolvedValue([]);     // remaining Tier 4 sources

    llm.mockResolvedValueOnce({
      results: [{ is_review: true, text: 'אוכל מדהים ביותר מסעדה', rating: 5, reviewer_name: 'דנה' }],
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platform: 'Facebook', source_origin: 'tavily' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 1 }));
  });

  test('all 10 multi-source platforms are queried when newReviews === 0', async () => {
    tavily.mockResolvedValue([]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    const queries = (tavily.mock.calls as string[][]).map(([q]) => q);
    const expectedFragments = [
      'facebook.com', 'instagram.com', 'tripadvisor',
      'waze.com', 'tiktok.com', 'wolt.com',
      '10bis.co.il', 'easy.co.il', 'booking.com', 'tapuz.co.il',
    ];
    for (const frag of expectedFragments) {
      expect(queries.some(q => q.includes(frag))).toBe(true);
    }
  });

  test('Tier 4 does not auto-scan all sources when a prior tier already wrote reviews', async () => {
    // Tier 3 finds a review → newReviews = 1 → sourcesToScan falls back to requestedSources (empty)
    tavily.mockResolvedValueOnce([
      { url: 'https://example.com/rev', content: 'ביקורת מצוינת על מסעדה טסט שירות מהיר', snippet: '' },
    ]);
    llm.mockResolvedValueOnce({
      results: [{ is_review: true, text: 'ביקורת מצוינת על מסעדה', rating: 5, reviewer_name: 'יוסי' }],
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    // Only 1 Tavily call (Tier 3 direct); no Tier 4 site: queries
    const queries = (tavily.mock.calls as string[][]).map(([q]) => q);
    expect(queries.some(q => q.includes('site:'))).toBe(false);
  });
});

// ── KAN-17 AC: Tier 5 — RawSignal → Haiku classification ─────────────────────

describe('collectReviews — KAN-17 Tier 5: RawSignal→Haiku', () => {
  beforeEach(() => {
    socialFindFirst.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ candidates: [], status: 'ZERO_RESULTS', result: { reviews: [] } }),
    });
    tavily.mockResolvedValue([]);  // Tiers 3 + 4 yield nothing → Tier 5 eligible
  });

  test('triggers when all prior tiers yield nothing and classifies RawSignal as Review', async () => {
    rawSignalFindMany.mockResolvedValue([{
      id: 'rs1',
      url: 'https://google.com/maps/search/Test+Biz',
      content: 'Test Biz שירות נפלא ואוכל מצוין',
      source_origin: 'tavily',
      created_date: new Date().toISOString(),
    }]);
    llm.mockResolvedValueOnce({
      results: [{ is_review: true, text: 'שירות נפלא ואוכל מצוין', rating: 5, reviewer_name: 'רועי', platform: 'Google' }],
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source_origin: 'tavily', text: 'שירות נפלא ואוכל מצוין' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 1 }));
  });

  test('Tier 5 is skipped when a prior tier already wrote reviews', async () => {
    // Override: Tier 3 finds a review → newReviews = 1 → Tier 5 guard (newReviews === 0) fails
    tavily.mockResolvedValueOnce([
      { url: 'https://example.com/rev', content: 'ביקורת מצוינת על מסעדה טסט שירות מהיר', snippet: '' },
    ]);
    llm.mockResolvedValueOnce({
      results: [{ is_review: true, text: 'ביקורת מצוינת על מסעדה', rating: 5, reviewer_name: 'יוסי' }],
    });
    rawSignalFindMany.mockResolvedValue([{
      id: 'rs1', url: 'https://google.com/maps/search/Test+Biz',
      content: 'Test Biz שירות נפלא', source_origin: 'tavily',
      created_date: new Date().toISOString(),
    }]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(rawSignalFindMany).not.toHaveBeenCalled();
  });

  test('raw signals from non-review platform URLs are pre-filtered and not sent to LLM', async () => {
    rawSignalFindMany.mockResolvedValue([{
      id: 'rs2',
      url: 'https://some-random-blog.com/post/123',  // not in reviewPlatforms list
      content: 'Test Biz אוכל טעים',
      source_origin: 'tavily',
      created_date: new Date().toISOString(),
    }]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(llm).not.toHaveBeenCalled();
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 0 }));
  });
});

// ── KAN-17 AC: cross-tier deduplication ───────────────────────────────────────

describe('collectReviews — KAN-17 deduplication', () => {
  beforeEach(() => {
    socialFindFirst.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ candidates: [], status: 'ZERO_RESULTS', result: { reviews: [] } }),
    });
  });

  test('Tavily result matching an existing review text prefix is not re-created', async () => {
    const existingText = 'ביקורת ישנה שכבר קיימת בדאטאבייס שלנו';
    reviewFindMany
      .mockResolvedValueOnce([{ text: existingText, google_review_id: null, source_url: null }])
      .mockResolvedValue([]);

    tavily.mockResolvedValueOnce([
      { url: 'https://example.com/dup', content: existingText, snippet: '' },
    ]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 0 }));
  });
});
