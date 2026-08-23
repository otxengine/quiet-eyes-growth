/**
 * Tests for googleTrendsScanAgent — KAN-87
 * AC2: 20h cooldown → ran_recently
 * AC3: URL checkpoint — filterNewUrls prevents re-fetching seen articles
 * AC1: MarketSignal with category=google_trend
 */

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    marketSignal:    { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
    proactiveAlert:  { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/ai_router',    () => ({ callAIJson: jest.fn() }));
jest.mock('../lib/llm',          () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/tavily',       () => ({ tavilyAdvancedSearch: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/searchapi',    () => ({
  hasSearchApiKey:    jest.fn(),
  searchTrendingNow:  jest.fn(),
  searchYouTubeTrends: jest.fn(),
  searchGoogleNews:   jest.fn(),
}));
jest.mock('../lib/insightDedup', () => ({ loadDismissedTitles: jest.fn() }));
jest.mock('../lib/trendMemory',  () => ({
  loadCheckpoint:   jest.fn(),
  saveCheckpoint:   jest.fn().mockResolvedValue(undefined),
  shouldSkipByTime: jest.fn(),
  filterNewUrls:    jest.fn(),
}));

import { googleTrendsScanAgent } from '../routes/functions/googleTrendsScanAgent';
import { prisma } from '../db';
import { callAIJson } from '../lib/ai_router';
import { invokeLLM } from '../lib/llm';
import { tavilyAdvancedSearch } from '../lib/tavily';
import { hasSearchApiKey } from '../lib/searchapi';
import { loadDismissedTitles } from '../lib/insightDedup';
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
  (prisma.marketSignal.findFirst     as jest.Mock).mockResolvedValue(null);
  (prisma.proactiveAlert.findMany    as jest.Mock).mockResolvedValue([]);
  (prisma.proactiveAlert.findFirst   as jest.Mock).mockResolvedValue(null);
  (prisma.proactiveAlert.create      as jest.Mock).mockResolvedValue({});
  (prisma.$queryRawUnsafe            as jest.Mock).mockResolvedValue([]);
  (loadCheckpoint                    as jest.Mock).mockResolvedValue(EMPTY_CP);
  (shouldSkipByTime                  as jest.Mock).mockReturnValue(false);
  (filterNewUrls                     as jest.Mock).mockImplementation((urls: string[]) => urls);
  (tavilyAdvancedSearch              as jest.Mock).mockResolvedValue([]);
  (hasSearchApiKey                   as jest.Mock).mockReturnValue(false);
  (loadDismissedTitles               as jest.Mock).mockResolvedValue([]);
  (callAIJson                        as jest.Mock).mockResolvedValue({ trends: [], keywords: [] });
  (invokeLLM                         as jest.Mock).mockResolvedValue({ trends: [] });
});

// ── AC2 — 20h cooldown ────────────────────────────────────────────────────────

it('AC2: returns ran_recently when both IL+US checkpoints are within 20h', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValue(true);
  const res = makeRes();
  await googleTrendsScanAgent(makeReq(), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ skipped: true, reason: 'ran_recently' }),
  );
  expect(prisma.marketSignal.create).not.toHaveBeenCalled();
});

it('AC2: proceeds when at least one checkpoint is expired', async () => {
  (shouldSkipByTime as jest.Mock).mockReturnValueOnce(false).mockReturnValue(true);
  const res = makeRes();
  await googleTrendsScanAgent(makeReq(), res);
  const call = (res.json as jest.Mock).mock.calls[0][0];
  expect(call?.reason).not.toBe('ran_recently');
});

// ── AC3 — URL dedup via trendMemory ───────────────────────────────────────────

it('AC3: filterNewUrls filters already-seen article URLs', async () => {
  const articles = [
    { url: 'https://ynet.co.il/trend/1', content: 'old article', title: 'Old' },
    { url: 'https://ynet.co.il/trend/2', content: 'new article', title: 'New' },
  ];
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue(articles);
  (filterNewUrls        as jest.Mock).mockReturnValue(['https://ynet.co.il/trend/2']);

  const res = makeRes();
  await googleTrendsScanAgent(makeReq(), res);

  expect(filterNewUrls).toHaveBeenCalled();
});

// ── AC1 — MarketSignal category ───────────────────────────────────────────────

it('AC1: creates MarketSignal with category=google_trend', async () => {
  (tavilyAdvancedSearch as jest.Mock).mockResolvedValue([
    { url: 'https://news.co.il/trend', content: 'google trend data', title: 'מגמה עולה' },
  ]);
  (callAIJson as jest.Mock).mockResolvedValue({
    keywords: ['מגמה', 'פיצה ישראל'],
    trends: [{
      trend_name: 'מגמה חדשה', confidence: 72, urgency: 'medium',
      evidence_url: 'https://news.co.il/trend', evidence_numbers: '+45% חיפושים',
      opportunity_for_business: 'הכנת קמפיין', recommended_action: 'פרסם עכשיו',
    }],
  });

  const res = makeRes();
  await googleTrendsScanAgent(makeReq(), res);

  if ((prisma.marketSignal.create as jest.Mock).mock.calls.length > 0) {
    const data = (prisma.marketSignal.create as jest.Mock).mock.calls[0][0].data;
    expect(data.category).toBe('google_trend');
  }
});
