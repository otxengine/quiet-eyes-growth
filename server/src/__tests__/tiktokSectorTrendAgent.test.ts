/**
 * Tests for tiktokSectorTrendAgent — KAN-87
 * AC1: writes MarketSignal with category=tiktok_sector_trend + script metadata
 * AC2: 8h cooldown → ran_recently; force:true bypasses cooldown
 * AC3: trendMemory filterNewIds prevents re-processing seen video IDs
 * AC4: free_trial/starter → plan_not_eligible; growth passes
 * AC5: no Apify → falls back to Tavily
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
    proactiveAlert:  { findFirst: jest.fn(), create: jest.fn() },
    automationLog:   { create: jest.fn() },
  },
}));
jest.mock('../lib/llm',             () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog',   () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/tavily',          () => ({ tavilyAdvancedSearch: jest.fn() }));
jest.mock('../lib/agentCache',      () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  TTL:      { API_RESULT: 3_600_000 },
}));
jest.mock('../lib/apify',           () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/businessContext', () => ({
  loadBusinessContext:    jest.fn(),
  formatContextForPrompt: jest.fn().mockReturnValue(''),
}));
jest.mock('../lib/trendMemory',     () => ({
  loadCheckpoint:   jest.fn(),
  saveCheckpoint:   jest.fn().mockResolvedValue(undefined),
  shouldSkipByTime: jest.fn(),
  filterNewIds:     jest.fn(),
}));

import { tiktokSectorTrendAgent } from '../routes/functions/tiktokSectorTrendAgent';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { tavilyAdvancedSearch } from '../lib/tavily';
import { runApifyActor, hasApifyKey } from '../lib/apify';
import { cacheGet } from '../lib/agentCache';
import { loadCheckpoint, shouldSkipByTime, filterNewIds } from '../lib/trendMemory';
import { loadBusinessContext } from '../lib/businessContext';

const PROFILE_GROWTH = {
  id: 'biz_001', name: 'Test Biz', category: 'מסעדה', city: 'תל אביב',
  relevant_services: 'פיצה', tone_preference: 'friendly', subscription_plan: 'growth',
  description: '', target_market: '', custom_keywords: '',
};

const EMPTY_CP = { _key: 'k', lastScanAt: null, scannedIds: new Set<string>(), scannedUrls: new Set<string>(), meta: {} };

function makeReq(overrides: any = {}) {
  return { body: { businessProfileId: 'biz_001', ...overrides } } as any;
}
function makeRes() {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  return { json, status } as any;
}

function makeTrend(overrides = {}) {
  return {
    pattern_name:          'Before/After של פיצה',
    why_it_works_in_sector: 'engagement גבוה בקרב מסעדות פיצה',
    service_spotlight:     'פיצה',
    evidence: {
      source:              'tavily_url',
      detail:              'https://tiktok.com/t1',
      avg_plays_per_day:   50000,
      engagement_rate_pct: 8.5,
    },
    content_script: {
      hook_3sec:         'תראו את פיצה מושלמת',
      body_20sec:        'פה מה שקורה במטבח',
      cta:               'עקבו עכשיו',
      visual_direction:  'צלם את הפיצה מהתנור',
      music_suggestion:  'upbeat',
    },
    hashtags:                  ['#מסעדה', '#פיצה'],
    recommended_sound:         'trending sound',
    best_posting_time:         'שלישי 19:00',
    opportunity_window_hours:  48,
    velocity:                  'fast_rising',
    estimated_reach_multiplier: 2.5,
    confidence:                75,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue(PROFILE_GROWTH);
  (prisma.marketSignal.findMany   as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create     as jest.Mock).mockResolvedValue({});
  (prisma.proactiveAlert.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.proactiveAlert.create   as jest.Mock).mockResolvedValue({});
  (loadCheckpoint                 as jest.Mock).mockResolvedValue(EMPTY_CP);
  (shouldSkipByTime               as jest.Mock).mockReturnValue(false);
  (filterNewIds                   as jest.Mock).mockImplementation((ids: string[]) => ids);
  (hasApifyKey                    as jest.Mock).mockReturnValue(false);
  (cacheGet                       as jest.Mock).mockReturnValue(null);
  (tavilyAdvancedSearch           as jest.Mock).mockResolvedValue([]);
  (invokeLLM                      as jest.Mock).mockResolvedValue({ trends: [], sector_sounds: [] });
  (loadBusinessContext             as jest.Mock).mockResolvedValue({ rejectedPatterns: [] });
});

// ── AC2 — 8h cooldown ─────────────────────────────────────────────────────────

it('AC2: returns ran_recently within 8h cooldown', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValue(true);
  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC2: force:true bypasses 8h cooldown', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValue(true);
  (invokeLLM        as jest.Mock).mockResolvedValue({ trends: [] });
  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq({ force: true }), res);
  // Did not return ran_recently
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('ran_recently');
});

// ── AC4 — plan gating ─────────────────────────────────────────────────────────

it('AC4: free_trial → plan_not_eligible', async () => {
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue({ ...PROFILE_GROWTH, subscription_plan: 'free_trial' });
  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC4: starter → plan_not_eligible', async () => {
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue({ ...PROFILE_GROWTH, subscription_plan: 'starter' });
  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'plan_not_eligible' }),
  );
});

it('AC4: growth plan passes gate', async () => {
  (invokeLLM as jest.Mock).mockResolvedValue({ trends: [] });
  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('plan_not_eligible');
});

// ── AC1 — MarketSignal category + script metadata ─────────────────────────────

it('AC1: creates MarketSignal with category=tiktok_sector_trend and script metadata', async () => {
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://tiktok.com/t1', content: 'viral video content', title: 'test' },
  ]);
  (invokeLLM as jest.Mock).mockResolvedValue({ trends: [makeTrend()], sector_sounds: [] });

  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);

  expect(prisma.marketSignal.create).toHaveBeenCalledTimes(1);
  const data = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
  expect(data.category).toBe('tiktok_sector_trend');

  const meta = JSON.parse(data.source_description);
  expect(meta).toMatchObject({
    action_type:          'tiktok_content',
    is_tiktok_sector_trend: true,
    content_script: expect.objectContaining({
      hook_3sec: expect.any(String),
      body_20sec: expect.any(String),
      cta:       expect.any(String),
    }),
  });
});

// ── AC3 — trendMemory dedup ───────────────────────────────────────────────────

it('AC3: filterNewIds applied — already-seen video IDs are skipped', async () => {
  const videos = [
    { id: 'v1', text: 'video 1', playCount: 100000, diggCount: 5000, commentCount: 200, hashtags: [] },
    { id: 'v2', text: 'video 2', playCount: 80000,  diggCount: 3000, commentCount: 100, hashtags: [] },
  ];
  (hasApifyKey    as jest.Mock).mockReturnValue(true);
  (cacheGet       as jest.Mock).mockReturnValue(null);
  (runApifyActor  as jest.Mock).mockResolvedValue(videos);
  (filterNewIds   as jest.Mock).mockReturnValue(['v2']); // v1 already seen
  (invokeLLM      as jest.Mock).mockResolvedValue({ trends: [], sector_sounds: [] });

  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);

  expect(filterNewIds).toHaveBeenCalledWith(['v1', 'v2'], EMPTY_CP);
});

// ── AC5 — Tavily fallback when no Apify ───────────────────────────────────────

it('AC5: no Apify key → Tavily used as data source', async () => {
  (hasApifyKey          as jest.Mock).mockReturnValue(false);
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://tiktok.com/t2', content: 'trending content', title: 'viral' },
  ]);
  (invokeLLM as jest.Mock).mockResolvedValue({ trends: [makeTrend()], sector_sounds: [] });

  const res = makeRes();
  await tiktokSectorTrendAgent(makeReq(), res);

  expect(tavilyAdvancedSearch).toHaveBeenCalled();
  expect(runApifyActor).not.toHaveBeenCalled();
});
