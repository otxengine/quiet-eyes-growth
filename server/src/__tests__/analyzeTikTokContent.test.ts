import { Request } from 'express';
import { analyzeTikTokContent } from '../routes/functions/analyzeTikTokContent';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { tavilySearch } from '../lib/tavily';
import { getValidTikTokToken } from '../lib/tiktokTokenRefresh';
import { hasSearchApiKey, searchTikTokProfileVideos } from '../lib/searchapi';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    socialAccount:   { findFirst: jest.fn(), update: jest.fn() },
    rawSignal:       { create: jest.fn() },
    marketSignal:    { create: jest.fn() },
  },
}));
jest.mock('../lib/llm',               () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',     () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/apify',             () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/agentCache',        () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/tavily',            () => ({ tavilySearch: jest.fn() }));
jest.mock('../lib/tiktokTokenRefresh', () => ({ getValidTikTokToken: jest.fn() }));
jest.mock('../lib/searchapi',         () => ({ hasSearchApiKey: jest.fn(), searchTikTokProfileVideos: jest.fn() }));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const bpFindFirst       = prisma.businessProfile.findFirst as jest.Mock;
const saFindFirst       = prisma.socialAccount.findFirst   as jest.Mock;
const saUpdate          = prisma.socialAccount.update      as jest.Mock;
const rawSignalCreate   = prisma.rawSignal.create          as jest.Mock;
const marketSignalCreate = prisma.marketSignal.create      as jest.Mock;
const llm               = invokeLLM                        as jest.Mock;
const apifyActor        = runApifyActor                    as jest.Mock;
const apifyKey          = hasApifyKey                      as jest.Mock;
const skipAgent         = shouldSkipAgent                  as jest.Mock;
const tavily            = tavilySearch                     as jest.Mock;
const tikTokToken       = getValidTikTokToken              as jest.Mock;
const searchApiKey      = hasSearchApiKey                  as jest.Mock;
const searchTikTok      = searchTikTokProfileVideos        as jest.Mock;

const PROFILE = { id: 'bp1', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב', tiktok_url: null };
const VIDEOS  = [
  { title: 'Video 1', view_count: 100, like_count: 10, comment_count: 2, share_url: 'https://tiktok.com/v/1' },
  { title: 'Video 2', view_count: 200, like_count: 20, comment_count: 4, share_url: 'https://tiktok.com/v/2' },
];
const LLM_RESULT = {
  performance_insight: 'Good engagement',
  sector_trend:        'Short cooking clips',
  trending_formats:    ['Reel', 'Tutorial'],
  recommended_action:  'Post at 19:00',
  best_posting_hour:   19,
  top_hashtags:        ['#food', '#israel', '#tlv'],
  confidence:          0.8,
};

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

beforeEach(() => {
  jest.resetAllMocks();
  bpFindFirst.mockResolvedValue(PROFILE);
  saFindFirst.mockResolvedValue(null);
  rawSignalCreate.mockResolvedValue({});
  marketSignalCreate.mockResolvedValue({});
  saUpdate.mockResolvedValue({});
  llm.mockResolvedValue(LLM_RESULT);
  (writeAutomationLog as jest.Mock).mockResolvedValue(undefined);
  apifyKey.mockReturnValue(false);
  skipAgent.mockReturnValue(false);
  tikTokToken.mockResolvedValue(null);
  tavily.mockResolvedValue([]);
  searchApiKey.mockReturnValue(false);
  searchTikTok.mockResolvedValue([]);
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
});

// ── AC1: RawSignal + MarketSignal written and counted ─────────────────────────

describe('AC1 — RawSignal + MarketSignal written', () => {

  test('Apify videos → RawSignal per video + 2 MarketSignals', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue(VIDEOS);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(rawSignalCreate).toHaveBeenCalledTimes(2);
    expect(rawSignalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        linked_business: 'bp1',
        platform:        'tiktok',
        signal_type:     'video',
        source_origin:   'apify_url',
      }),
    }));
    expect(marketSignalCreate).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      raw_signals_created:    2,
      market_signals_created: 2,
      items_created:          4,
      videos_analyzed:        2,
    }));
  });

  test('MarketSignal categories are social and trend', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue(VIDEOS);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    const categories = (marketSignalCreate as jest.Mock).mock.calls.map(c => c[0].data.category);
    expect(categories).toContain('social');
    expect(categories).toContain('trend');
  });

  test('no video source → 0 RawSignals, still writes MarketSignals from LLM', async () => {
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(rawSignalCreate).not.toHaveBeenCalled();
    expect(marketSignalCreate).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ raw_signals_created: 0, videos_analyzed: 0 }));
  });

  test('TikTok OAuth videos → RawSignal written with source tiktok_api', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'open123', account_name: 'testbiz' });
    tikTokToken.mockResolvedValue('valid-token');
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({ data: { videos: VIDEOS } }),
    });

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(rawSignalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source_origin: 'tiktok_api' }),
    }));
  });

  test('LLM returns no performance_insight → only sector_trend MarketSignal written', async () => {
    llm.mockResolvedValue({ ...LLM_RESULT, performance_insight: undefined });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(marketSignalCreate).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ market_signals_created: 1 }));
  });

});

// ── AC2: Source fallback + failure logging ────────────────────────────────────

describe('AC2 — source fallback chain', () => {

  test('TikTok API fails → Apify (tiktok_url) attempted next', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'open123' });
    tikTokToken.mockResolvedValue('valid-token');
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) }); // API fails → []
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue(VIDEOS);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(apifyActor).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ videos_analyzed: 2 }));
  });

  test('Apify (tiktok_url) fails → Apify (account_name) attempted', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: null, account_name: 'testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor
      .mockResolvedValueOnce([])      // tiktok_url attempt fails
      .mockResolvedValueOnce(VIDEOS); // account_name attempt succeeds
    llm.mockResolvedValue(LLM_RESULT);
    tavily.mockResolvedValue([]);
    (writeAutomationLog as jest.Mock).mockResolvedValue(undefined);
    rawSignalCreate.mockResolvedValue({});
    marketSignalCreate.mockResolvedValue({});
    skipAgent.mockReturnValue(false);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(apifyActor).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ videos_analyzed: 2, data_source: 'apify' }));
  });

  test('all sources fail → SearchAPI fallback attempted when key available', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([]);
    searchApiKey.mockReturnValue(true);
    searchTikTok.mockResolvedValue([
      { title: 'SA Video', views: 50, likes: 5, comments: 1, url: 'https://tiktok.com/v/sa1' },
    ]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(searchTikTok).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ videos_analyzed: 1, data_source: 'searchapi' }));
  });

  test('source failure is logged via console.warn', async () => {
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue([]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('analyzeTikTokContent'));
    warnSpy.mockRestore();
  });

});

// ── AC3 KAN-21 — expired/revoked TikTok token surfaced, not a silent zero ─────

describe('AC3 KAN-21 — expired/revoked TikTok token', () => {

  test('401 from TikTok API → is_connected: false + oauth_error returned, Apify not called', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'open123', account_name: 'biz' });
    tikTokToken.mockResolvedValue('valid-token');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(saUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sa1' },
      data:  expect.objectContaining({ is_connected: false, last_error: 'tiktok_auth_401' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true, reason: 'tiktok_auth_401' }));
    expect(apifyActor).not.toHaveBeenCalled();
    expect(rawSignalCreate).not.toHaveBeenCalled();
  });

  test('403 from TikTok API → is_connected: false + oauth_error returned', async () => {
    saFindFirst.mockResolvedValue({ id: 'sa1', access_token: 'tok', page_id: 'open123', account_name: 'biz' });
    tikTokToken.mockResolvedValue('valid-token');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(saUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sa1' },
      data:  expect.objectContaining({ is_connected: false, last_error: 'tiktok_auth_403' }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ oauth_error: true, reason: 'tiktok_auth_403' }));
  });

});

// ── AC3: 12h cooldown ─────────────────────────────────────────────────────────

describe('AC3 — 12h cooldown', () => {

  test('ran_recently → skips agent, returns ran_recently reason', async () => {
    skipAgent.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(json).toHaveBeenCalledWith({ videos_analyzed: 0, skipped: true, reason: 'ran_recently' });
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalledWith('analyzeTikTokContent', 'bp1', expect.any(String), 0, 'success', 'ran_recently');
    expect(llm).not.toHaveBeenCalled();
    expect(rawSignalCreate).not.toHaveBeenCalled();
  });

  test('setLastRun called after successful run', async () => {
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(setLastRun as jest.Mock).toHaveBeenCalledWith('bp1', 'analyzeTikTokContent');
  });

});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('edge cases', () => {

  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await analyzeTikTokContent(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when business profile not found', async () => {
    bpFindFirst.mockResolvedValue(null);
    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('DB error → 500 + automationLog written with failed status', async () => {
    rawSignalCreate.mockRejectedValue(new Error('DB connection lost'));
    bpFindFirst.mockResolvedValue({ ...PROFILE, tiktok_url: 'https://tiktok.com/@testbiz' });
    apifyKey.mockReturnValue(true);
    apifyActor.mockResolvedValue(VIDEOS);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await analyzeTikTokContent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(writeAutomationLog as jest.Mock).toHaveBeenCalledWith(
      'analyzeTikTokContent', 'bp1', expect.any(String), 0, 'failed', expect.any(String),
    );
  });

});
