/**
 * Unit tests — analyzeSocialPosts cross-business donor cache.
 * Covers: fresh donor found -> copies deep analysis, never calls the LLM;
 * no fresh donor -> falls through to a normal analysis (which itself hits
 * invokeLLM, verified indirectly via the mocked call being reached).
 */

const queryRawUnsafe = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    competitor: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
  },
}));

jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn() }));
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn() }));

import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { findDonorCandidates } from '../lib/competitorDonor';
import { analyzeSocialPosts } from '../routes/functions/analyzeSocialPosts';

const COMP = {
  id: 'c1', linked_business: 'b1', name: 'Test Co', category: 'cafe',
  content_themes: null, engagement_level: null, strongest_channel: null,
  social_post_frequency: null, social_followers_est: null,
  social_deep_analysis: null, social_deep_analysis_at: null,
  google_place_id: 'place1', instagram_url: 'https://instagram.com/testco', facebook_url: null, tiktok_url: null,
};

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.competitor.findFirst as jest.Mock).mockResolvedValue(COMP);
});

test('fresh donor found -> copies deep analysis and never calls the LLM', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  const donorAnalysis = JSON.stringify({ visual_identity: 'x' });
  queryRawUnsafe.mockResolvedValueOnce([
    { id: 'donor-1', social_deep_analysis: donorAnalysis, social_deep_analysis_at: new Date().toISOString() },
  ]);
  (prisma.competitor.findUnique as jest.Mock).mockResolvedValue({
    social_deep_analysis: donorAnalysis, social_deep_analysis_at: new Date().toISOString(),
  });

  const req: any = { body: { competitorId: 'c1', businessProfileId: 'b1' } };
  const res = mockRes();
  await analyzeSocialPosts(req, res);

  expect(invokeLLM).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cloned: true }));
});

test('no fresh donor -> falls through to a normal analysis (invokeLLM reached)', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValue([{ id: 'donor-1', linked_business: 'other-biz' }]);
  queryRawUnsafe
    .mockResolvedValueOnce([]) // no donor with fresh social_deep_analysis_at
    .mockResolvedValueOnce([]) // posts SELECT inside analyzeCompetitorContent
    .mockResolvedValueOnce([]); // ads SELECT inside analyzeCompetitorContent
  (invokeLLM as jest.Mock).mockResolvedValue({ visual_identity: 'x', content_pillars: [] });

  const req: any = { body: { competitorId: 'c1', businessProfileId: 'b1' } };
  await analyzeSocialPosts(req, mockRes());

  expect(invokeLLM).toHaveBeenCalled();
});
