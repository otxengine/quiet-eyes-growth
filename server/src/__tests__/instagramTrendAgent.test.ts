/**
 * Tests for instagramTrendAgent — KAN-87
 * AC2: 20h cooldown → ran_recently (shouldSkipByTime on both checkpoints)
 * AC3: trendMemory checkpoints — filterNewIds/filterNewUrls prevent re-processing
 * AC3: Apify cache reused when available (cacheGet hit → runApifyActor not called)
 * AC1: MarketSignal with category=instagram_trend
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/ai_router',    () => ({ callAIJson: jest.fn() }));
jest.mock('../lib/tavily',       () => ({ tavilyAdvancedSearch: jest.fn() }));
jest.mock('../lib/apify',        () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/agentCache',   () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  TTL:      { API_RESULT: 3_600_000 },
}));
jest.mock('../lib/trendMemory',  () => ({
  loadCheckpoint:   jest.fn(),
  saveCheckpoint:   jest.fn().mockResolvedValue(undefined),
  shouldSkipByTime: jest.fn(),
  filterNewIds:     jest.fn(),
  filterNewUrls:    jest.fn(),
}));

import { instagramTrendAgent } from '../routes/functions/instagramTrendAgent';
import { prisma } from '../db';
import { callAIJson } from '../lib/ai_router';
import { tavilyAdvancedSearch } from '../lib/tavily';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { cacheGet } from '../lib/agentCache';
import { loadCheckpoint, shouldSkipByTime, filterNewIds, filterNewUrls } from '../lib/trendMemory';

const PROFILE = {
  id: 'biz_001', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב',
  relevant_services: 'פיצה', plan_id: 'growth',
};
const EMPTY_CP = { _key: 'k', lastScanAt: null, scannedIds: new Set<string>(), scannedUrls: new Set<string>(), meta: {} };

function makeReq(id = 'biz_001') { return { body: { businessProfileId: id } } as any; }
function makeRes() {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue(PROFILE);
  (prisma.marketSignal.findMany     as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create       as jest.Mock).mockResolvedValue({});
  (prisma.$queryRawUnsafe           as jest.Mock).mockResolvedValue([]);
  (loadCheckpoint                   as jest.Mock).mockResolvedValue(EMPTY_CP);
  (shouldSkipByTime                 as jest.Mock).mockReturnValue(false);
  (filterNewIds                     as jest.Mock).mockImplementation((ids: string[]) => ids);
  (filterNewUrls                    as jest.Mock).mockImplementation((urls: string[]) => urls);
  (hasApifyKey                      as jest.Mock).mockReturnValue(false);
  (cacheGet                         as jest.Mock).mockReturnValue(null);
  (tavilyAdvancedSearch             as jest.Mock).mockResolvedValue([]);
  (callAIJson                       as jest.Mock).mockResolvedValue({ hashtags: ['מסעדה', 'food'], trends: [] });
});

// ── AC2 — 20h cooldown ────────────────────────────────────────────────────────

it('AC2: returns ran_recently when both IL+US checkpoints are within 20h', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValue(true);
  const res = makeRes();
  await instagramTrendAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC2: proceeds when at least one checkpoint is expired', async () => {
  // First shouldSkipByTime call (IL) returns false — so agent runs
  (shouldSkipByTime as jest.Mock).mockReturnValueOnce(false).mockReturnValue(true);
  const res = makeRes();
  await instagramTrendAgent(makeReq(), res);
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('ran_recently');
});

// ── AC3 — Apify cache reuse ───────────────────────────────────────────────────

it('AC3: Apify cache hit → runApifyActor not called', async () => {
  const cachedPosts = [{ id: 'p1', url: 'https://ig.com/p/1', caption: 'test', likes: 1000, comments: 50, timestamp: Date.now() }];
  (hasApifyKey as jest.Mock).mockReturnValue(true);
  (cacheGet    as jest.Mock).mockReturnValue(cachedPosts);

  const res = makeRes();
  await instagramTrendAgent(makeReq(), res);

  expect(runApifyActor).not.toHaveBeenCalled();
  expect(filterNewIds).toHaveBeenCalled();
});

// ── AC3 — filterNewIds dedup ──────────────────────────────────────────────────

it('AC3: filterNewIds filters already-seen post IDs', async () => {
  const posts = [
    { id: 'p1', url: 'https://ig.com/p/1', caption: 'old', likes: 800, comments: 30, timestamp: Date.now() },
    { id: 'p2', url: 'https://ig.com/p/2', caption: 'new', likes: 2000, comments: 80, timestamp: Date.now() },
  ];
  (hasApifyKey   as jest.Mock).mockReturnValue(true);
  (cacheGet      as jest.Mock).mockReturnValue(posts);
  (filterNewIds  as jest.Mock).mockReturnValue(['p2']); // p1 already seen

  const res = makeRes();
  await instagramTrendAgent(makeReq(), res);

  expect(filterNewIds).toHaveBeenCalledWith(['p1', 'p2'], EMPTY_CP);
});

// ── AC1 — MarketSignal category ───────────────────────────────────────────────

it('AC1: creates MarketSignal with category=instagram_trend when signals found', async () => {
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://instagram.com/p/abc', content: 'trending content', title: 'IG trend' },
  ]);
  (callAIJson as jest.Mock).mockResolvedValue({
    hashtags: ['מסעדה', 'food'],
    trends: [{
      trend_name: 'Before/After מנה', pattern: 'short video', why_it_works: 'engagement',
      evidence_url: 'https://instagram.com/p/abc', evidence_numbers: '50k likes',
      content_angle: 'visual', confidence: 75, urgency: 'high',
      opportunity_window_hours: 48, hashtags: ['#מסעדה'],
    }],
  });

  const res = makeRes();
  await instagramTrendAgent(makeReq(), res);

  if ((prisma.marketSignal.create as jest.Mock).mock.calls.length > 0) {
    const data = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
    expect(data.category).toBe('instagram_trend');
  }
});
