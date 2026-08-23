import { Request } from 'express';
import { analyzeSocialComments } from '../routes/functions/analyzeSocialComments';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { tavilySearch } from '../lib/tavily';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    socialAccount:   { findFirst: jest.fn(), update: jest.fn() },
    marketSignal:    { create: jest.fn() },
  },
}));
jest.mock('../lib/llm',          () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/apify',        () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/agentCache',   () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/tavily',       () => ({ tavilySearch: jest.fn() }));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const bpFindFirst = prisma.businessProfile.findFirst as jest.Mock;
const saFindFirst = prisma.socialAccount.findFirst   as jest.Mock;
const msCreate    = prisma.marketSignal.create       as jest.Mock;
const llm         = invokeLLM                        as jest.Mock;
const apifyActor  = runApifyActor                    as jest.Mock;
const apifyKey    = hasApifyKey                      as jest.Mock;
const skipAgent   = shouldSkipAgent                  as jest.Mock;
const tavily      = tavilySearch                     as jest.Mock;

const PROFILE = { id: 'bp1', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב', facebook_url: null };

const LLM_NEUTRAL = {
  overall_sentiment: 'mixed',
  positive_count: 0,
  negative_count: 0,
  neutral_count: 3,
  top_complaints: [],
  top_praise: [],
  urgent_issues: [],
  recommended_response: '',
  has_crisis: false,
};

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

beforeEach(() => {
  bpFindFirst.mockResolvedValue(PROFILE);
  saFindFirst.mockResolvedValue(null);
  (prisma.socialAccount.update as jest.Mock).mockResolvedValue({});
  msCreate.mockResolvedValue({});
  llm.mockResolvedValue(LLM_NEUTRAL);
  (writeAutomationLog as jest.Mock).mockResolvedValue(undefined);
  apifyKey.mockReturnValue(false);
  apifyActor.mockResolvedValue([]);
  skipAgent.mockReturnValue(false);
  (setLastRun as jest.Mock).mockReturnValue(undefined);
  tavily.mockResolvedValue([]);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});

// ── AC3: 12h cooldown ─────────────────────────────────────────────────────────

describe('AC3 — 12h cooldown', () => {

  test('ran_recently → skips immediately, no fetch or LLM calls', async () => {
    skipAgent.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);
    expect(json).toHaveBeenCalledWith({ comments_analyzed: 0, skipped: true, reason: 'ran_recently' });
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalledWith('analyzeSocialComments', 'bp1', expect.any(String), 0, 'success', 'ran_recently');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
  });

});

// ── AC1: connected facebook_page → comments analyzed, MarketSignal written ───

describe('AC1 — OAuth facebook_page path', () => {

  const FB_ACCOUNT = { id: 'sa1', access_token: 'tok', page_id: 'page123' };

  test('crisis detected → MarketSignal(alert, high) created', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ message: 'terrible' }, { message: 'awful' }, { message: 'worst' }] }) });
    llm.mockResolvedValue({ ...LLM_NEUTRAL, has_crisis: true, negative_count: 3, urgent_issues: ['service failure'] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(msCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'alert', impact_level: 'high', linked_business: 'bp1' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ page_connected: true, comments_analyzed: 3 }));
  });

  test('negative_count > 3, no crisis flag → MarketSignal(alert, medium)', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ message: 'bad' }, { message: 'bad' }, { message: 'bad' }, { message: 'bad' }] }) });
    llm.mockResolvedValue({ ...LLM_NEUTRAL, has_crisis: false, negative_count: 4 });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(msCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'alert', impact_level: 'medium' }),
    }));
  });

  test('5+ positive comments with praise → MarketSignal(opportunity) created', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: Array(5).fill({ message: 'great!' }) }) });
    llm.mockResolvedValue({ ...LLM_NEUTRAL, positive_count: 5, top_praise: ['great service', 'loved it'] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(msCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'opportunity', linked_business: 'bp1' }),
    }));
  });

  test('all-neutral sentiment → no MarketSignal written', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ message: 'ok' }] }) });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(msCreate).not.toHaveBeenCalled();
  });

  test('no posts returned → 0 analyzed, LLM not called', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(llm).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ comments_analyzed: 0, page_connected: true }));
  });

  test('posts returned but all comment fetches empty → 0 analyzed, LLM not called', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(llm).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ comments_analyzed: 0, page_connected: true }));
  });

  test('Graph API posts fetch fails (ok: false) → 0 analyzed, no LLM, no 500', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(llm).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  test('AC3 — Graph API returns 401 → account marked disconnected, oauth_error returned', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(prisma.socialAccount.update as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: FB_ACCOUNT.id },
      data:  expect.objectContaining({ is_connected: false }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true }));
    expect(llm).not.toHaveBeenCalled();
  });

  test('setLastRun and writeAutomationLog called on success', async () => {
    saFindFirst.mockResolvedValue(FB_ACCOUNT);
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', message: 'post', created_time: 't' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ message: 'ok' }] }) });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(setLastRun as jest.Mock).toHaveBeenCalledWith('bp1', 'analyzeSocialComments');
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalledWith(
      'analyzeSocialComments', 'bp1', expect.any(String), expect.any(Number),
    );
  });

});

// ── AC2: no facebook_page → graceful fallback ─────────────────────────────────

describe('AC2 — no facebook_page connection', () => {

  test('Apify key + facebook_url → Apify path used, response has source: apify', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, facebook_url: 'https://facebook.com/testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([
      { comments: [{ text: 'bad service' }, { text: 'awful' }, { text: 'terrible' }, { text: 'worst' }] },
    ]);
    llm.mockResolvedValue({ ...LLM_NEUTRAL, negative_count: 4 });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(apifyActor).toHaveBeenCalledWith('apify~facebook-posts-scraper', expect.objectContaining({
      startUrls: [{ url: 'https://facebook.com/testbiz' }],
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ page_connected: false, source: 'apify' }));
  });

  test('Apify key + facebook_url but no comments → 0 analyzed, LLM not called, no 500', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, facebook_url: 'https://facebook.com/testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([{ comments: [] }]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(llm).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ comments_analyzed: 0, source: 'apify' }));
  });

  test('no Apify, no facebook_url → Tavily fallback called', async () => {
    tavily.mockResolvedValue([
      { content: 'great place, loved it very much!', title: 'review' },
      { content: 'good service overall, highly recommended', title: 'review 2' },
    ]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(tavily).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ source: 'tavily' }));
  });

  test('no Apify, no facebook_url, Tavily empty → page_connected: false, automationLog written, no 500', async () => {
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeSocialComments(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      comments_analyzed: 0,
      page_connected: false,
    }));
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

});

// ── Input validation + profile guard ─────────────────────────────────────────

describe('input validation', () => {

  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await analyzeSocialComments(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('404 when no business profile found', async () => {
    bpFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ businessProfileId: 'missing' });
    await analyzeSocialComments(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

});
