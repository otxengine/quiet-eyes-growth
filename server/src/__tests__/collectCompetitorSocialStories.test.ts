/**
 * Unit tests — collectCompetitorSocialStories.
 * Covers: username extraction from instagram_url, upsert on external_story_id,
 * and the no-instagram-url skip path.
 */

const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
// Pre-fetch (SELECT analyzed_at) returns no rows by default (nothing analyzed yet);
// the upsert (INSERT ... RETURNING id) returns a fresh row id — override per-test as needed.
const queryRawUnsafe = jest.fn(async (sql: string) => {
  if (String(sql).includes('SELECT competitor_id, external_story_id')) return [];
  if (String(sql).includes('INSERT INTO competitor_stories')) return [{ id: `row-${queryRawUnsafe.mock.calls.length}` }];
  return [];
});

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
  },
}));

jest.mock('../lib/apify', () => ({
  hasApifyKey: jest.fn(() => true),
  runApifyActor: jest.fn(),
}));

jest.mock('../lib/s3', () => ({
  isS3Configured: jest.fn(() => false),
  uploadImageFromUrl: jest.fn(),
}));

jest.mock('../lib/agentCache', () => ({
  shouldSkipAgent: jest.fn(() => false),
  setLastRun: jest.fn(),
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

jest.mock('../lib/analyzePostCreative', () => ({
  analyzePostCreative: jest.fn(async () => null),
}));

jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { findDonorCandidates } from '../lib/competitorDonor';
import { collectCompetitorSocialStories, extractInstagramUsername } from '../routes/functions/collectCompetitorSocialStories';

const COMP = {
  id: 'c1', name: 'פר דרייר', not_relevant: false, tracking_status: 'approved',
  google_place_id: 'place1', instagram_url: 'https://www.instagram.com/perdrier/',
};

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function insertCalls() {
  return queryRawUnsafe.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO competitor_stories'));
}

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(undefined);
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
});

test('extractInstagramUsername pulls the bare handle out of a profile URL', () => {
  expect(extractInstagramUsername('https://www.instagram.com/perdrier/')).toBe('perdrier');
  expect(extractInstagramUsername('https://instagram.com/perdrier')).toBe('perdrier');
  expect(extractInstagramUsername('https://instagram.com/p/abc123/')).toBeNull(); // post link, not a profile
  expect(extractInstagramUsername(null)).toBeNull();
});

test('matches returned stories back to their competitor by username and inserts one row per story', async () => {
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    {
      pk: 'story-1',
      user: { username: 'perdrier' },
      media_type: 1,
      image_versions2: { candidates: [{ url: 'https://cdn.example/img.jpg' }] },
      taken_at: 1700000000,
      expiring_at: 1700086400,
    },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialStories(req, mockRes());

  expect(runApifyActor).toHaveBeenCalledWith(
    'dLL7b34nRrgN6ZV24',
    { usernames: ['perdrier'] },
    expect.any(Number),
    expect.any(Number),
    expect.any(Function),
  );
  expect(insertCalls()).toHaveLength(1);
});

test('a story from an unrecognized username is skipped, not inserted', async () => {
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    { pk: 'story-x', user: { username: 'someone_else' }, media_type: 1, taken_at: 1700000000 },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialStories(req, mockRes());

  expect(insertCalls()).toHaveLength(0);
});

test('a story already analyzed on a prior scrape is not re-analyzed', async () => {
  const { analyzePostCreative } = require('../lib/analyzePostCreative');
  queryRawUnsafe.mockImplementationOnce(async (sql: string) =>
    String(sql).includes('SELECT competitor_id, external_story_id')
      ? [{ competitor_id: 'c1', external_story_id: 'story-1' }]
      : [],
  );
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    {
      pk: 'story-1',
      user: { username: 'perdrier' },
      media_type: 1,
      image_versions2: { candidates: [{ url: 'https://cdn.example/img.jpg' }] },
      taken_at: 1700000000,
    },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialStories(req, mockRes());

  expect(analyzePostCreative).not.toHaveBeenCalled();
});

test('clones another business\'s archived stories regardless of freshness, and still scrapes live via Apify', async () => {
  (findDonorCandidates as jest.Mock).mockResolvedValueOnce([{ id: 'donor-1', linked_business: 'other-biz' }]);
  executeRawUnsafe.mockResolvedValueOnce(2); // donor clone recovered 2 historical rows Apify can no longer scrape
  (runApifyActor as jest.Mock).mockResolvedValueOnce([]); // nothing currently live, but that's irrelevant to the backfill

  const req: any = { body: { businessProfileId: 'b1' } };
  const res = mockRes();
  await collectCompetitorSocialStories(req, res);

  expect(findDonorCandidates).toHaveBeenCalledWith('c1', 'b1', {
    googlePlaceId: 'place1', platform: 'instagram', urlValue: COMP.instagram_url,
  });
  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeTruthy();
  // Unlike the posts donor cache, a donor never short-circuits the live Apify scrape here —
  // donors only carry history, not today's currently-live stories.
  expect(runApifyActor).toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ upserted: 2 }));
});

test('no donor candidates -> skips the clone query entirely', async () => {
  (runApifyActor as jest.Mock).mockResolvedValueOnce([]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialStories(req, mockRes());

  const cloneCall = executeRawUnsafe.mock.calls.find(([sql]) => String(sql).includes('gen_random_uuid()::text'));
  expect(cloneCall).toBeFalsy();
});

test('competitor with no instagram_url is skipped before ever calling Apify', async () => {
  (prisma.competitor.findMany as jest.Mock).mockResolvedValueOnce([{ ...COMP, instagram_url: null }]);

  const req: any = { body: { businessProfileId: 'b1' } };
  const res = mockRes();
  await collectCompetitorSocialStories(req, res);

  expect(runApifyActor).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ upserted: 0 }));
});
