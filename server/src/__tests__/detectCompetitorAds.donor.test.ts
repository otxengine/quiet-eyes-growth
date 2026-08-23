/**
 * Unit tests — detectCompetitorAds cross-business donor cache.
 * Covers: fresh donor found -> clones ad history, never calls SearchAPI/LLM;
 * no fresh donor -> falls through to a normal scan.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(0);

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findFirst: jest.fn() },
    competitor: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
    competitorAdHistory: { updateMany: jest.fn().mockResolvedValue({}) },
    proactiveAlert: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    marketSignal: { create: jest.fn().mockResolvedValue({}) },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
  },
}));

jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));
jest.mock('../lib/agentCache', () => ({ shouldSkipAgent: jest.fn(() => false), setLastRun: jest.fn() }));
jest.mock('../lib/searchapi', () => ({ searchAllAds: jest.fn(async () => []), hasSearchApiKey: jest.fn(() => true) }));
jest.mock('../lib/s3', () => ({ isS3Configured: jest.fn(() => false), uploadImageFromUrl: jest.fn() }));
jest.mock('../lib/analyzePostCreative', () => ({ analyzePostCreative: jest.fn(async () => null) }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn() }));

import { prisma } from '../db';
import { searchAllAds } from '../lib/searchapi';
import { invokeLLM } from '../lib/llm';
import { findDonorCandidates } from '../lib/competitorDonor';
import { detectCompetitorAds } from '../routes/functions/detectCompetitorAds';

const COMP = {
  id: 'c1', name: 'Test Co', not_relevant: false, tracking_status: 'approved',
  google_place_id: 'place1', instagram_url: 'https://instagram.com/testco', facebook_url: null, tiktok_url: null,
  sponsored_ads_updated_at: null,
};

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(0);
  (prisma.businessProfile.findFirst as jest.Mock).mockResolvedValue({ id: 'b1', name: 'My Biz', category: 'cafe', city: 'TLV' });
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
  (prisma.competitor.findUnique as jest.Mock).mockResolvedValue({
    sponsored_ads_detected: true, active_ad_platforms: 'facebook', active_ad_count: 2,
    active_ads_summary: '[]', ad_target_audience: null, ad_strategy_summary: null,
    ad_spend_signal: 'medium', ad_gaps: null, ad_intel_updated_at: new Date().toISOString(),
  });
});

test('fresh donor found -> clones ad history and never calls SearchAPI/LLM', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([{ id: 'donor-1', sponsored_ads_updated_at: new Date().toISOString() }]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await detectCompetitorAds(req, mockRes());

  expect(searchAllAds).not.toHaveBeenCalled();
  expect(invokeLLM).not.toHaveBeenCalled();
  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeTruthy();
});

test('no fresh donor -> falls through to a normal scan', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe.mockResolvedValueOnce([]); // no donor with sponsored_ads_updated_at set

  const req: any = { body: { businessProfileId: 'b1' } };
  await detectCompetitorAds(req, mockRes());

  expect(searchAllAds).toHaveBeenCalled();
});
