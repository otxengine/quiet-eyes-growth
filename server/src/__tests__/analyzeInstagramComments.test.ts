import { Request } from 'express';
import { analyzeInstagramComments } from '../routes/functions/analyzeInstagramComments';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { shouldSkipAgent } from '../lib/agentCache';
import { tavilySearch } from '../lib/tavily';
import { hasSearchApiKey, searchInstagramPosts } from '../lib/searchapi';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    socialAccount:   { findFirst: jest.fn(), update: jest.fn() },
    marketSignal:    { create: jest.fn() },
    proactiveAlert:  { create: jest.fn() },
  },
}));
jest.mock('../lib/llm',          () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/apify',        () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/agentCache',   () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/tavily',       () => ({ tavilySearch: jest.fn() }));
jest.mock('../lib/searchapi',    () => ({ hasSearchApiKey: jest.fn(), searchInstagramPosts: jest.fn() }));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const bpFindMany        = prisma.businessProfile.findMany  as jest.Mock;
const saFindFirst       = prisma.socialAccount.findFirst   as jest.Mock;
const marketSignalCreate = prisma.marketSignal.create      as jest.Mock;
const alertCreate       = prisma.proactiveAlert.create     as jest.Mock;
const llm               = invokeLLM                        as jest.Mock;
const apifyActor        = runApifyActor                    as jest.Mock;
const apifyKey          = hasApifyKey                      as jest.Mock;
const skipAgent         = shouldSkipAgent                  as jest.Mock;
const tavily            = tavilySearch                     as jest.Mock;
const searchApiKey      = hasSearchApiKey                  as jest.Mock;

const PROFILE = { id: 'bp1', name: 'Test Biz', category: 'restaurant', city: 'TLV', instagram_url: null };

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

beforeEach(() => {
  bpFindMany.mockResolvedValue([PROFILE]);
  saFindFirst.mockResolvedValue(null);
  (prisma.socialAccount.update as jest.Mock).mockResolvedValue({});
  marketSignalCreate.mockResolvedValue({});
  alertCreate.mockResolvedValue({});
  llm.mockResolvedValue({ sentiments: [], urgent_negative: [] });
  (writeAutomationLog as jest.Mock).mockResolvedValue(undefined);
  apifyKey.mockReturnValue(false);
  skipAgent.mockReturnValue(false);
  tavily.mockResolvedValue([]);
  searchApiKey.mockReturnValue(false);
  (searchInstagramPosts as jest.Mock).mockResolvedValue([]);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});

// ── AC1: sentiment classification + ProactiveAlert ────────────────────────────

describe('AC1 — OAuth path', () => {

  test('negative comments (urgent) create ProactiveAlert(negative_comment)', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', comments_count: 3 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ text: 'terrible' }, { text: 'worst' }, { text: 'awful' }] }) });
    llm.mockResolvedValue({ sentiments: ['negative', 'negative', 'negative'], urgent_negative: ['terrible'] });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'negative_comment', linked_business: 'bp1' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ urgent_alerts: 1 }));
  });

  test('3 negatives with no urgent_negative still creates ProactiveAlert (AC1-B)', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', comments_count: 3 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ text: 'meh' }, { text: 'bad' }, { text: 'not great' }] }) });
    llm.mockResolvedValue({ sentiments: ['negative', 'negative', 'negative'], urgent_negative: [] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(marketSignalCreate).toHaveBeenCalled();
    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'negative_comment' }),
    }));
  });

  test('fewer than 3 negatives — no MarketSignal, no ProactiveAlert', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'p1', comments_count: 2 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ text: 'ok' }, { text: 'fine' }] }) });
    llm.mockResolvedValue({ sentiments: ['positive', 'neutral'], urgent_negative: [] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(marketSignalCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });

  test('media fetch fails → returns 0 analyzed, no alerts', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(alertCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ comments_analyzed: 0 }));
  });

});

describe('AC1 — Apify path', () => {

  test('comments from instagram_url → sentiment → ProactiveAlert', async () => {
    bpFindMany.mockResolvedValue([{ ...PROFILE, instagram_url: 'https://instagram.com/testbiz' }]);
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([{
      latestComments: [{ text: 'terrible' }, { text: 'very bad' }, { text: 'awful' }],
    }]);
    llm.mockResolvedValue({ sentiments: ['negative', 'negative', 'negative'], urgent_negative: ['terrible'] });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'negative_comment' }),
    }));
  });

  test('Apify returns no comments → 0 analyzed, no alerts', async () => {
    bpFindMany.mockResolvedValue([{ ...PROFILE, instagram_url: 'https://instagram.com/testbiz' }]);
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([{ latestComments: [] }]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(alertCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ comments_analyzed: 0 }));
  });

});

// ── AC2: no-op when no IG connection or URL ───────────────────────────────────

describe('AC2 — no-op path', () => {

  test('no account, no URL → returns 0, no DB writes', async () => {
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(alertCreate).not.toHaveBeenCalled();
    expect(marketSignalCreate).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      comments_analyzed: 0,
      note: expect.stringContaining('not connected'),
    }));
  });

  test('no account, no URL → skip reason logged to console', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no-op'));
    spy.mockRestore();
  });

  test('no account, no URL → Tavily NOT called', async () => {
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(tavily).not.toHaveBeenCalled();
  });

});

// ── AC3 KAN-21 — expired/revoked token surfaced, not a silent zero ────────────

describe('AC3 KAN-21 — expired/revoked IG token', () => {

  test('401 response → is_connected: false + last_error set + oauth_error returned', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(prisma.socialAccount.update as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sa1' },
      data:  expect.objectContaining({ is_connected: false, last_error: 'ig_auth_401' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true, reason: 'ig_auth_401' }));
    expect(alertCreate).not.toHaveBeenCalled();
  });

  test('403 response → is_connected: false + oauth_error returned', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'uid1' });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(prisma.socialAccount.update as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sa1' },
      data:  expect.objectContaining({ is_connected: false, last_error: 'ig_auth_403' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true, reason: 'ig_auth_403' }));
  });

});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {

  test('ran_recently → skips, LLM not called', async () => {
    skipAgent.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeInstagramComments(req, res);

    expect(json).toHaveBeenCalledWith({ comments_analyzed: 0, skipped: true, reason: 'ran_recently' });
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalledWith('analyzeInstagramComments', 'bp1', expect.any(String), 0, 'success', 'ran_recently');
    expect(llm).not.toHaveBeenCalled();
  });

  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await analyzeInstagramComments(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

});
