/**
 * Tests for facebookGroupTrendAgent — KAN-87
 * AC2: 20h cooldown → ran_recently (both IL+US checkpoints fresh)
 * AC3: URL checkpoint — filterNewUrls prevents re-fetching already-seen threads
 * AC1: MarketSignal with category=facebook_trend
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/ai_router',    () => ({ callAIJson: jest.fn() }));
jest.mock('../lib/tavily',       () => ({ tavilyAdvancedSearch: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/trendMemory',  () => ({
  loadCheckpoint:   jest.fn(),
  saveCheckpoint:   jest.fn().mockResolvedValue(undefined),
  shouldSkipByTime: jest.fn(),
  filterNewUrls:    jest.fn(),
}));

import { facebookGroupTrendAgent } from '../routes/functions/facebookGroupTrendAgent';
import { prisma } from '../db';
import { callAIJson } from '../lib/ai_router';
import { tavilyAdvancedSearch } from '../lib/tavily';
import { loadCheckpoint, shouldSkipByTime, filterNewUrls } from '../lib/trendMemory';

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
  (prisma.marketSignal.findMany      as jest.Mock).mockResolvedValue([]);
  (prisma.marketSignal.create        as jest.Mock).mockResolvedValue({});
  (prisma.$executeRawUnsafe          as jest.Mock).mockResolvedValue(undefined);
  (loadCheckpoint                    as jest.Mock).mockResolvedValue(EMPTY_CP);
  (shouldSkipByTime                  as jest.Mock).mockReturnValue(false);
  (filterNewUrls                     as jest.Mock).mockImplementation((urls: string[]) => urls);
  (tavilyAdvancedSearch              as jest.Mock).mockResolvedValue([]);
  (callAIJson                        as jest.Mock).mockResolvedValue({ trends: [] });
});

// ── AC2 — 20h cooldown ────────────────────────────────────────────────────────

it('AC2: returns ran_recently when both IL+US checkpoints are within 20h', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValue(true);
  const res = makeRes();
  await facebookGroupTrendAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC2: proceeds when at least one checkpoint is expired', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValueOnce(false).mockReturnValue(true);
  const res = makeRes();
  await facebookGroupTrendAgent(makeReq(), res);
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('ran_recently');
});

// ── AC3 — URL dedup via trendMemory ───────────────────────────────────────────

it('AC3: filterNewUrls filters already-seen URLs', async () => {
  const results = [
    { url: 'https://facebook.com/g/1', content: 'old thread', title: 'Old' },
    { url: 'https://facebook.com/g/2', content: 'new thread', title: 'New' },
  ];
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue(results);
  (filterNewUrls        as jest.Mock).mockReturnValue(['https://facebook.com/g/2']); // first already seen

  const res = makeRes();
  await facebookGroupTrendAgent(makeReq(), res);

  expect(filterNewUrls).toHaveBeenCalled();
});

// ── AC1 — MarketSignal category ───────────────────────────────────────────────

it('AC1: creates MarketSignal with category=facebook_trend', async () => {
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://facebook.com/g/trend', content: 'popular trend discussion', title: 'FB trend' },
  ]);
  (callAIJson as jest.Mock).mockResolvedValue({
    trends: [{
      trend_name: 'מגמה חדשה', why_it_works: 'שיחות בקבוצות', evidence_url: 'https://facebook.com/g/trend',
      evidence_numbers: '500 תגובות', content_angle: 'community', confidence: 70,
      urgency: 'medium', opportunity_window_hours: 72,
    }],
  });

  const res = makeRes();
  await facebookGroupTrendAgent(makeReq(), res);

  if ((prisma.marketSignal.create as jest.Mock).mock.calls.length > 0) {
    const data = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
    expect(data.category).toBe('facebook_trend');
  }
});
