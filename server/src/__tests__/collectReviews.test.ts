import { Request } from 'express';
import { collectReviews } from '../routes/functions/collectReviews';
import { prisma } from '../db';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { publishEvent } from '../lib/eventBus';
import { submitGoogleReviewsTask } from '../lib/dataforseo';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../lib/dataforseo', () => ({
  submitGoogleReviewsTask: jest.fn(),
  hasDataForSeoCreds:      jest.fn(() => true),
}));

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn(), update: jest.fn() },
    review:          { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    socialAccount:   { findFirst: jest.fn(), update: jest.fn() },
    competitor:      { findMany: jest.fn() },
    marketSignal:    { findFirst: jest.fn(), create: jest.fn() },
    proactiveAlert:  { findFirst: jest.fn(), create: jest.fn() },
    dataForSeoReviewTask: { create: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/agentCache',    () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/llm',           () => ({ invokeLLM: jest.fn(), startCostTracking: jest.fn(), popCost: jest.fn().mockReturnValue(0) }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/crypto',       () => ({ tryDecryptToken: (v: string) => v })); // fixtures hold decrypted tokens
jest.mock('../lib/eventBus',      () => ({ publishEvent: jest.fn() }));

// Mock global fetch
global.fetch = jest.fn() as jest.Mock;

const bpFindMany       = prisma.businessProfile.findMany    as jest.Mock;
const bpUpdate         = prisma.businessProfile.update      as jest.Mock;
const reviewFindMany   = prisma.review.findMany             as jest.Mock;
const reviewCreate     = prisma.review.create               as jest.Mock;
const reviewFindFirst  = prisma.review.findFirst            as jest.Mock;
const reviewUpdateMany = prisma.review.updateMany           as jest.Mock;
const socialFindFirst  = prisma.socialAccount.findFirst     as jest.Mock;
const competitorFindMany = prisma.competitor.findMany       as jest.Mock;
const msFindFirst      = prisma.marketSignal.findFirst      as jest.Mock;
const msCreate         = prisma.marketSignal.create         as jest.Mock;
const alertFindFirst   = prisma.proactiveAlert.findFirst    as jest.Mock;
const alertCreate      = prisma.proactiveAlert.create       as jest.Mock;
const dfsTaskCreate    = prisma.dataForSeoReviewTask.create as jest.Mock;
const execRaw          = prisma.$executeRawUnsafe           as jest.Mock;
const skipAgent        = shouldSkipAgent                    as jest.Mock;
const llm              = invokeLLM                          as jest.Mock;
const autoLog          = writeAutomationLog                 as jest.Mock;
const mockFetch          = global.fetch                       as jest.Mock;
const submitTask       = submitGoogleReviewsTask            as jest.Mock;

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
  (prisma.socialAccount.update as jest.Mock).mockResolvedValue({});
  competitorFindMany.mockResolvedValue([]);
  msFindFirst.mockResolvedValue(null);
  msCreate.mockResolvedValue({});
  alertFindFirst.mockResolvedValue(null);
  alertCreate.mockResolvedValue({});
  dfsTaskCreate.mockResolvedValue({});
  submitTask.mockResolvedValue({ taskId: 'task-own-1', costUsd: 0.0225 });
  reviewUpdateMany.mockResolvedValue({ count: 0 });
  execRaw.mockResolvedValue(undefined);
  skipAgent.mockReturnValue(false);
  (setLastRun as jest.Mock).mockReturnValue(undefined);
  llm.mockResolvedValue({ results: [] });
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
    expect(autoLog).toHaveBeenCalledWith('collectReviews', 'bp1', expect.any(String), 0, 'success', 'ran_recently');
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

describe('collectReviews — KAN-23 AC#1 content truncation', () => {

  test('review text longer than 2000 chars is truncated to 2000 before storage (GMB path)', async () => {
    const longText = 'מ'.repeat(2500);
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview({ comment: longText })], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: longText.substring(0, 2000) }),
    }));
    expect(reviewCreate.mock.calls[0][0].data.text).toHaveLength(2000);
  });

});

describe('collectReviews — KAN-34 AC2: GMB connected + nothing new = success', () => {
  test('gmb_path is success and AutomationLog status success even when 0 new reviews', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    // GMB API returns no reviews (all previously de-duped)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [], nextPageToken: undefined }),
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ gmb_path: 'success' }));
    expect(json).not.toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true }));
    expect(autoLog).toHaveBeenCalledWith(
      'collectReviews', 'bp1', expect.any(String), 0, 'success', undefined, expect.any(Number),
    );
  });
});

describe('collectReviews — AC1: GMB connected → reviews fetched and de-duped by google_review_id', () => {

  test('GMB reviews are fetched and written with correct fields', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: ['service'], sentiments: { service: 'positive' } }] });

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

  test('GMB 401 response: marks account disconnected, returns oauth_error, no Places fallback', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({ error: { message: 'Invalid Credentials' } }),
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(prisma.socialAccount.update as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: GMB_ACCOUNT.id },
      data:  expect.objectContaining({ is_connected: false }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_reviews: 0, oauth_error: true, reason: 'gmb_401' }));
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  test('GMB 401: AutomationLog called with status failed and gmb_401 in message', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401,
      json: jest.fn().mockResolvedValue({ error: { message: 'Invalid Credentials' } }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(autoLog).toHaveBeenCalledWith(
      'collectReviews', 'bp1', expect.any(String), 0, 'failed',
      expect.stringContaining('gmb_401'),
    );
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

// ── KAN-18 AC1: topics and topic_sentiment persisted ─────────────────────────

describe('collectReviews — KAN-18 AC1: topics and topic_sentiment persisted', () => {
  test('topics and topic_sentiment written to each new review', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({
      results: [{ topics: ['service', 'price'], sentiments: { service: 'positive', price: 'neutral' } }],
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        topics:          'service,price',
        topic_sentiment: JSON.stringify({ service: 'positive', price: 'neutral' }),
      }),
    }));
  });
});

// ── KAN-123: taxonomy constraints ────────────────────────────────────────────

describe('collectReviews — KAN-123 taxonomy', () => {
  beforeEach(() => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
  });

  test('max 6 topics stored even when LLM returns more', async () => {
    // restaurant sector: 10 topics available (5 CORE + 5 pack) — LLM returns 7, cap must clip to 6
    bpFindMany.mockResolvedValue([{ ...PROFILE, sector_profile: JSON.stringify({ sector_key: 'restaurant', onboarding_review_extras: [] }) }]);
    llm.mockResolvedValue({
      results: [{ topics: ['service','price','quality','cleanliness','atmosphere','food_quality','wait_time'], sentiments: { service:'positive', price:'neutral', quality:'positive', cleanliness:'positive', atmosphere:'positive', food_quality:'positive', wait_time:'negative' } }],
    });
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    const stored: string = reviewCreate.mock.calls[0][0].data.topics;
    expect(stored.split(',').length).toBe(6);
  });

  test('free-label topics not in taxonomy are filtered out', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['free_label', 'service'], sentiments: { free_label: 'positive', service: 'positive' } }],
    });
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    const stored: string = reviewCreate.mock.calls[0][0].data.topics;
    expect(stored).toBe('service');
  });

  test('topics stored empty when LLM returns topics without matching sentiments', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['service'], sentiments: {} }],
    });
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    expect(reviewCreate.mock.calls[0][0].data.topics).toBe('');
    expect(reviewCreate.mock.calls[0][0].data.topic_sentiment).toBe('{}');
  });

  test('fallback on LLM failure stores empty topics, not sentinel string', async () => {
    llm.mockRejectedValue(new Error('timeout'));
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);
    expect(reviewCreate.mock.calls[0][0].data.topics).toBe('');
    expect(reviewCreate.mock.calls[0][0].data.topic_sentiment).toBe('{}');
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
      .mockResolvedValueOnce([{ rating: 5 }])          // own google_rating recompute (googleAdded > 0)
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
    llm.mockResolvedValue({ results: [{ topics: ['service'], sentiments: { service: 'negative' } }] });
    reviewFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ rating: 1 }])
      .mockResolvedValueOnce([{ rating: 1 }])          // own google_rating recompute (googleAdded > 0)
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
      .mockResolvedValueOnce([{ rating: 1 }])          // own google_rating recompute (googleAdded > 0)
      .mockResolvedValueOnce([{ id: 'r1', sentiment: 'negative', rating: 1, reviewer_name: 'לקוח', text: 'גרוע' }])
      .mockResolvedValueOnce([{ id: 'r1' }]);
    alertFindFirst.mockResolvedValue({ id: 'existing-alert' });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(alertCreate).not.toHaveBeenCalled();
  });

  test('negative review: ProactiveAlert, rating_history INSERT, and new_review event all produced', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [gmbReview({ starRating: 'ONE', comment: 'גרוע מאוד' })],
        nextPageToken: undefined,
      }),
    });
    llm.mockResolvedValue({ results: [{ topics: ['service'], sentiments: { service: 'negative' } }] });
    reviewFindMany.mockImplementation((opts: any) => {
      if (opts?.select?.rating)          return Promise.resolve([{ rating: 1 }]);
      if (opts?.select?.id)              return Promise.resolve([{ id: 'r1' }]);
      if (opts?.where?.sentiment === 'negative')
        return Promise.resolve([{ id: 'r1', sentiment: 'negative', rating: 1, reviewer_name: 'ישראל ישראלי', text: 'גרוע מאוד' }]);
      return Promise.resolve([]);
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'negative_review', linked_business: 'bp1' }),
    }));
    expect(execRaw).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO rating_history'),
      'bp1', expect.any(Number), expect.any(Number), expect.any(Number), 'collectReviews',
    );
    expect(publishEvent as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'new_review',
      payload: expect.objectContaining({ review_id: 'r1' }),
    }));
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

// ── KAN-120 AC2: early stop when page is all-known ────────────────────────────

describe('collectReviews — KAN-120 AC2: early stop when page is all-known', () => {
  test('stops after first page when all its reviews are already known', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'accounts/123/locations/456/reviews/rev001',
      text: 'מעולה מאוד!',
    }]);
    // page 1 returns only the known review but advertises a page 2 — should not be fetched
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: 'token-page2' }),
    });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    // Assert pagination stopped — GMB page 2 must never be requested
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('pageToken=token-page2'),
      expect.anything(),
    );
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ google_reviews_added: 0 }));
  });

  test('continues to page 2 when page 1 has at least one new review', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    // comments must be >5 chars to pass the short-text guard
    const page1New = gmbReview({ name: 'accounts/123/locations/456/reviews/new1', comment: 'ביקורת מעולה על השירות' });
    const page2New = gmbReview({ name: 'accounts/123/locations/456/reviews/new2', comment: 'אוכל טעים ומחיר סביר' });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ reviews: [page1New], nextPageToken: 'tok2' }) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ reviews: [page2New], nextPageToken: undefined }) });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }, { topics: [], sentiments: {} }] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('pageToken=tok2'), expect.anything());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ google_reviews_added: 2 }));
  });
});

// ── KAN-120 AC4: reply sync on already-stored review ─────────────────────────

describe('collectReviews — KAN-120 AC4: reply sync on known review', () => {
  test('updateMany called with response_status + suggested_response when known review has a reply', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'accounts/123/locations/456/reviews/rev001',
      text: 'מעולה מאוד!',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [gmbReview({ reviewReply: { comment: 'תודה רבה!' } })],
        nextPageToken: undefined,
      }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewUpdateMany).toHaveBeenCalledWith({
      where: { google_review_id: 'accounts/123/locations/456/reviews/rev001', linked_business: 'bp1' },
      data:  { response_status: 'published', suggested_response: 'תודה רבה!' },
    });
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  test('no updateMany when known review has no reply', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'accounts/123/locations/456/reviews/rev001',
      text: 'מעולה מאוד!',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview({ reviewReply: null })], nextPageToken: undefined }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewUpdateMany).not.toHaveBeenCalled();
    expect(reviewCreate).not.toHaveBeenCalled();
  });
});

// ── KAN-120 AC3: immutable fields never written on update ────────────────────

describe('collectReviews — KAN-120 AC3: immutable fields not overwritten', () => {
  test('update data never contains text, rating, topics, or topic_sentiment', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      google_review_id: 'accounts/123/locations/456/reviews/rev001',
      text: 'original text',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        reviews: [gmbReview({ comment: 'changed body!', starRating: 'ONE', reviewReply: { comment: 'תגובה' } })],
        nextPageToken: undefined,
      }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewUpdateMany).toHaveBeenCalled();
    for (const call of reviewUpdateMany.mock.calls) {
      const data = call[0].data;
      expect(data).not.toHaveProperty('text');
      expect(data).not.toHaveProperty('rating');
      expect(data).not.toHaveProperty('topics');
      expect(data).not.toHaveProperty('topic_sentiment');
    }
  });
});

// ── DataForSEO is the review source: no Places / SerpAPI / web-search fallback ──

describe('collectReviews — DataForSEO is the review source', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, DATAFORSEO_REVIEWS_ENABLED: 'true' };
    bpFindMany.mockResolvedValue([{ ...PROFILE, google_place_id: 'ChIJmine' }]);
  });
  afterEach(() => { process.env = OLD_ENV; });

  test('submits a DataForSEO task for the stored place and calls no other source', async () => {
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'ChIJmine', tag: 'bp1' }));
    expect(dfsTaskCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ task_type: 'own', business_profile_id: 'bp1' }) });
    expect(mockFetch).not.toHaveBeenCalled();     // no Google Places / web call
    expect(llm).not.toHaveBeenCalled();           // no web-search classification
    expect(reviewCreate).not.toHaveBeenCalled();  // reviews arrive later through the webhook
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ dataforseo_task_pending: true }));
    expect(autoLog).toHaveBeenCalledWith('collectReviews', 'bp1', expect.any(String), 0, 'success', undefined, expect.any(Number));
  });

  test('switched off: nothing is collected from any other source, and the run is logged as failed', async () => {
    process.env.DATAFORSEO_REVIEWS_ENABLED = 'false';
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(submitTask).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ dataforseo_task_pending: false, reason: 'dataforseo_disabled' }));
    expect(autoLog).toHaveBeenCalledWith('collectReviews', 'bp1', expect.any(String), 0, 'failed', 'dataforseo_disabled', expect.any(Number));
  });

  test('not sent when the connected Business Profile already added reviews', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview()], nextPageToken: undefined }),
    });
    llm.mockResolvedValue({ results: [{ topics: [], sentiments: {} }] });
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewCreate).toHaveBeenCalled();
    expect(submitTask).not.toHaveBeenCalled();
  });
});

describe('collectReviews — scraped review linked to its GBP review name', () => {
  test('text+rating match on a scraped review sets google_review_id instead of skipping', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      id: 'scraped1', platform: 'Google', rating: 5, linked_competitor: null,
      google_review_id: 'serp-xyz', text: 'מעולה מאוד!',
    }]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ reviews: [gmbReview({ reviewReply: { comment: 'תודה!' } })] }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewUpdateMany).toHaveBeenCalledWith({
      where: { id: 'scraped1', linked_business: 'bp1' },
      data:  {
        google_review_id: 'accounts/123/locations/456/reviews/rev001',
        response_status: 'published', suggested_response: 'תודה!',
      },
    });
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  test('competitor review with the same text is not linked', async () => {
    socialFindFirst.mockResolvedValue(GMB_ACCOUNT);
    reviewFindMany.mockResolvedValue([{
      id: 'comp1', platform: 'Google', rating: 5, linked_competitor: 'c1',
      google_review_id: null, text: 'מעולה מאוד!',
    }]);
    mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ reviews: [gmbReview()] }) });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectReviews(req, res);

    expect(reviewUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'comp1' }) }));
  });
});
