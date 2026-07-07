/**
 * Tests for detectViralSignals — KAN-76
 * AC1: creates MarketSignal category=viral_signal with content template in metadata
 * AC2: filterNewIds applied on cache-hit path (not just fresh Apify calls)
 * AC3: non-Growth plan skips with plan_not_eligible
 * AC4: 12h cooldown skips with ran_recently
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/llm',           () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/trendMemory',   () => ({
  loadCheckpoint: jest.fn(),
  filterNewIds:   jest.fn(),
  saveCheckpoint: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/tavily', () => ({
  tavilyAdvancedSearch: jest.fn(),
  isTavilyRateLimited:  jest.fn(),
}));
jest.mock('../lib/apify', () => ({
  runApifyActor: jest.fn(),
  hasApifyKey:   jest.fn(),
}));
jest.mock('../lib/agentCache', () => ({
  shouldSkipAgent: jest.fn(),
  setLastRun:      jest.fn(),
  cacheGet:        jest.fn(),
  cacheSet:        jest.fn(),
  TTL:             { API_RESULT: 3_600_000 },
}));

import { detectViralSignals } from '../routes/functions/detectViralSignals';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { loadCheckpoint, filterNewIds } from '../lib/trendMemory';
import { isTavilyRateLimited, tavilyAdvancedSearch } from '../lib/tavily';
import { hasApifyKey, runApifyActor } from '../lib/apify';
import { shouldSkipAgent, cacheGet } from '../lib/agentCache';

const PROFILE_GROWTH = {
  id: 'biz_001', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב',
  relevant_services: 'פיצה', tone_preference: 'friendly', plan_id: 'growth',
};
const EMPTY_CP = { _key: 'k', lastScanAt: null, scannedIds: new Set<string>(), scannedUrls: new Set<string>(), meta: {} };

function makeReq(id = 'biz_001') { return { body: { businessProfileId: id } } as any; }
function makeRes() {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

function makeSignal(overrides = {}) {
  return {
    title: 'ויראלי בדיקה', platform: 'tiktok', content_format: 'reel',
    hashtags: ['#test'], velocity: 'exploding', window_hours: 24,
    evidence_url: 'https://example.com', ready_to_post_text: 'פוסט בדיקה',
    visual_direction: 'צלם', relevance: 'high', confidence: 80,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(PROFILE_GROWTH);
  (prisma.marketSignal.findMany     as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create       as jest.Mock).mockResolvedValue({});
  (loadCheckpoint                   as jest.Mock).mockResolvedValue(EMPTY_CP);
  (filterNewIds                     as jest.Mock).mockImplementation((ids: string[]) => ids);
  (shouldSkipAgent                  as jest.Mock).mockReturnValue(false);
  (hasApifyKey                      as jest.Mock).mockReturnValue(false);
  (isTavilyRateLimited              as jest.Mock).mockReturnValue(true); // skip Tavily by default
  (cacheGet                         as jest.Mock).mockReturnValue(null);
  (invokeLLM                        as jest.Mock).mockResolvedValue({ signals: [] });
});

// ── AC4 — cooldown ────────────────────────────────────────────────────────────

it('AC4: returns ran_recently within 12h cooldown', async () => {
  (shouldSkipAgent as jest.Mock).mockReturnValue(true);
  const res = makeRes();
  await detectViralSignals(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

// ── AC3 — plan gate ───────────────────────────────────────────────────────────

it('AC3: skips with plan_not_eligible for free_trial plan', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ ...PROFILE_GROWTH, plan_id: 'free_trial' });
  const res = makeRes();
  await detectViralSignals(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC3: skips with plan_not_eligible for starter plan', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({ ...PROFILE_GROWTH, plan_id: 'starter' });
  const res = makeRes();
  await detectViralSignals(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
});

it('AC3: growth plan proceeds past gate', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({ signals: [] });
  const res = makeRes();
  await detectViralSignals(makeReq(), res);
  // Would have called create if signals existed — just confirm no plan_not_eligible
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('plan_not_eligible');
});

// ── AC1 — creates viral_signal MarketSignal with content template ─────────────

it('AC1: creates MarketSignal with category=viral_signal and content template', async () => {
  (isTavilyRateLimited as jest.Mock).mockReturnValue(false);
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://example.com', content: 'viral content test', title: 'test' },
  ]);
  (invokeLLM as jest.Mock).mockResolvedValue({ signals: [makeSignal()] });

  const res = makeRes();
  await detectViralSignals(makeReq(), res);

  expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
  const call = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0];
  expect(call.data.category).toBe('viral_signal');

  const meta = JSON.parse(call.data.source_description);
  expect(meta).toMatchObject({
    action_type:      'social_post',
    platform:         'tiktok',
    content_format:   'reel',
    is_viral_signal:  true,
    ready_to_post_text: expect.any(String),
  });
});

// ── AC2 — filterNewIds applied on cache-hit path ──────────────────────────────

it('AC2: filterNewIds runs even when Apify result comes from cache', async () => {
  const cachedVideos = [
    { id: 'vid_001', text: 'video 1', playCount: 100000, diggCount: 5000, commentCount: 200, hashtags: [] },
    { id: 'vid_002', text: 'video 2', playCount: 80000,  diggCount: 3000, commentCount: 100, hashtags: [] },
  ];
  (hasApifyKey   as jest.Mock).mockReturnValue(true);
  (cacheGet      as jest.Mock).mockReturnValue(cachedVideos); // simulate cache hit
  (filterNewIds  as jest.Mock).mockReturnValue(['vid_002']);  // vid_001 already seen
  (invokeLLM     as jest.Mock).mockResolvedValue({ signals: [makeSignal()] });

  const res = makeRes();
  await detectViralSignals(makeReq(), res);

  expect(filterNewIds).toHaveBeenCalledWith(['vid_001', 'vid_002'], EMPTY_CP);
  expect(runApifyActor).not.toHaveBeenCalled(); // confirms it was a cache hit
});
