import { Request, Response } from 'express';
import { collectSocialSignals } from '../routes/functions/collectSocialSignals';
import { prisma } from '../db';
import { tavilySearch, isTavilyRateLimited } from '../lib/tavily';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { shouldSkipAgent, setLastRun } from '../lib/agentCache';
import { parseKeywords, buildUrlQueries } from '../lib/dataSources';
import { getSectorProfile, cityToEn } from '../lib/businessProfile';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { loadBusinessContext } from '../lib/businessContext';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findMany: jest.fn() },
    rawSignal:       { findMany: jest.fn(), create: jest.fn() },
    socialAccount:   { findFirst: jest.fn() },
    marketSignal:    { create: jest.fn(), count: jest.fn() },
    competitor:      { findMany: jest.fn() },
  },
}));
jest.mock('../lib/tavily',          () => ({ tavilySearch: jest.fn(), isTavilyRateLimited: jest.fn() }));
jest.mock('../lib/apify',           () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/agentCache',      () => ({ shouldSkipAgent: jest.fn(), setLastRun: jest.fn() }));
jest.mock('../lib/dataSources',     () => ({ parseKeywords: jest.fn(), buildUrlQueries: jest.fn() }));
jest.mock('../lib/businessProfile', () => ({ getSectorProfile: jest.fn(), cityToEn: jest.fn(() => 'Tel Aviv') }));
jest.mock('../lib/llm',             () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',   () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/businessContext', () => ({ loadBusinessContext: jest.fn() }));

const bpFindMany      = prisma.businessProfile.findMany as jest.Mock;
const signalFindMany  = prisma.rawSignal.findMany       as jest.Mock;
const signalCreate    = prisma.rawSignal.create         as jest.Mock;
const igAccount       = prisma.socialAccount.findFirst  as jest.Mock;
const msCreate        = prisma.marketSignal.create      as jest.Mock;
const msCount         = prisma.marketSignal.count       as jest.Mock;
const competitors     = prisma.competitor.findMany      as jest.Mock;
const tavily          = tavilySearch                    as jest.Mock;
const rateLimited     = isTavilyRateLimited             as jest.Mock;
const apifyRun        = runApifyActor                   as jest.Mock;
const apifyKey        = hasApifyKey                     as jest.Mock;
const skipAgent       = shouldSkipAgent                 as jest.Mock;
const llm             = invokeLLM                       as jest.Mock;
const autoLog         = writeAutomationLog              as jest.Mock;
const bizCtx          = loadBusinessContext             as jest.Mock;

const PROFILE = {
  id: 'bp1', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב',
  facebook_url: null, instagram_url: null, sector_profile: null,
};

function makeReqRes(body: any): { req: Request; res: any; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  bpFindMany.mockResolvedValue([PROFILE]);
  signalFindMany.mockResolvedValue([]);
  signalCreate.mockResolvedValue({});
  igAccount.mockResolvedValue(null);
  msCreate.mockResolvedValue({});
  msCount.mockResolvedValue(0);
  competitors.mockResolvedValue([]);
  tavily.mockResolvedValue([]);
  rateLimited.mockReturnValue(false);
  apifyRun.mockResolvedValue([]);
  apifyKey.mockReturnValue(false);
  skipAgent.mockReturnValue(false);
  (setLastRun as jest.Mock).mockReturnValue(undefined);
  (parseKeywords as jest.Mock).mockReturnValue([]);
  (buildUrlQueries as jest.Mock).mockReturnValue([]);
  (getSectorProfile as jest.Mock).mockReturnValue(null);
  (cityToEn as jest.Mock).mockReturnValue('Tel Aviv');
  llm.mockResolvedValue({ influencers: [] });
  autoLog.mockResolvedValue(undefined);
  bizCtx.mockResolvedValue({ preferredTone: 'professional' });
});

// ── AC#3 — 12h cooldown ────────────────────────────────────────────────────────

describe('collectSocialSignals — AC#3 cooldown', () => {

  test('cooldown active → ran_recently returned, no Tavily or DB writes', async () => {
    skipAgent.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);
    expect(json).toHaveBeenCalledWith({ new_signals: 0, skipped: true, reason: 'ran_recently' });
    expect(autoLog).toHaveBeenCalledWith('collectSocialSignals', 'bp1', expect.any(String), 0, 'success', 'ran_recently');
    expect(tavily).not.toHaveBeenCalled();
    expect(signalCreate).not.toHaveBeenCalled();
  });

});

// ── AC#2 — no social URLs/connections fallback ────────────────────────────────

describe('collectSocialSignals — AC#2 Tavily fallback', () => {

  test('no facebook_url / instagram_url / igAccount → Tavily runs, completes without error', async () => {
    tavily.mockResolvedValue([
      { url: 'https://www.facebook.com/post/1', content: 'some content', title: 'title' },
    ]);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);
    expect(tavily).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_signals: expect.any(Number) }));
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  test('Tavily rate-limited → function still completes, returns 0 signals', async () => {
    rateLimited.mockReturnValue(true);
    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_signals: 0 }));
    expect(res.status).not.toHaveBeenCalledWith(500);
  });


});

// ── AC#1 — signals written + negative MarketSignal ────────────────────────────

describe('collectSocialSignals — AC#1 RawSignal and MarketSignal writes', () => {

  test('Facebook Apify posts written as RawSignals when key + facebook_url present', async () => {
    apifyKey.mockReturnValue(true);
    bpFindMany.mockResolvedValue([{ ...PROFILE, facebook_url: 'https://facebook.com/testbiz' }]);
    apifyRun.mockResolvedValue([
      { url: 'https://facebook.com/testbiz/posts/1', text: 'Our daily special!' },
    ]);

    const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);

    expect(signalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: 'facebook',
        signal_type: 'social_mention',
        source_origin: 'apify',
        linked_business: 'bp1',
      }),
    }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ new_signals: 1 }));
  });

  test('negative keyword in RawSignal → MarketSignal created with confidence 0.8', async () => {
    signalFindMany
      .mockResolvedValueOnce([])  // dedup query (line 33)
      .mockResolvedValueOnce([{   // negative post-processing query (line 333)
        url: 'https://facebook.com/review/99',
        content: 'שירות גרוע מאוד, לא מומלץ לאף אחד',
        signal_type: 'social_review',
        platform: 'facebook',
      }]);
    msCount.mockResolvedValue(0);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);

    expect(msCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        confidence: 0.8,
        category: 'mention',
        impact_level: 'high',
        linked_business: 'bp1',
      }),
    }));
  });

  test('KAN-23 AC1: content longer than 500 chars is truncated before storage (Facebook Apify)', async () => {
    apifyKey.mockReturnValue(true);
    bpFindMany.mockResolvedValue([{ ...PROFILE, facebook_url: 'https://facebook.com/testbiz' }]);
    const longContent = 'א'.repeat(600);
    apifyRun.mockResolvedValue([{ url: 'https://facebook.com/post/1', text: longContent }]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);

    expect(signalCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: longContent.substring(0, 500) }),
    }));
    expect(signalCreate.mock.calls[0][0].data.content).toHaveLength(500);
  });

  test('duplicate URL already in DB is not re-inserted', async () => {
    signalFindMany.mockResolvedValueOnce([{ url: 'https://facebook.com/post/already' }]);
    tavily.mockResolvedValue([
      { url: 'https://facebook.com/post/already', content: 'dup' },
      { url: 'https://facebook.com/post/new', content: 'new' },
    ]);

    const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
    await collectSocialSignals(req, res);

    const createdUrls = signalCreate.mock.calls.map((c: any[]) => c[0].data.url);
    expect(createdUrls).not.toContain('https://facebook.com/post/already');
    expect(createdUrls).toContain('https://facebook.com/post/new');
  });

});

// ── Input validation ───────────────────────────────────────────────────────────

describe('collectSocialSignals — input validation', () => {

  test('400 when businessProfileId missing', async () => {
    const { req, res } = makeReqRes({});
    await collectSocialSignals(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(tavily).not.toHaveBeenCalled();
  });

});
