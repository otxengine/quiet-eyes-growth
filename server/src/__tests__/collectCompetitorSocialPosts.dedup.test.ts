/**
 * Unit tests — collectCompetitorSocialPosts dedup cascade (content_hash fix).
 * Covers: null-external-id posts matching via content_hash update instead of
 * inserting a duplicate; normalized post_url matching across tracking-param/
 * trailing-slash variants; caption-less posts never hash-colliding with each other.
 */

const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);

jest.mock('../db', () => ({
  prisma: {
    competitor: { findMany: jest.fn() },
    $queryRawUnsafe: (...args: any[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: any[]) => executeRawUnsafe(...args),
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

jest.mock('../lib/analyzePostCreative', () => ({
  analyzePostCreative: jest.fn(async () => null),
}));

jest.mock('../lib/agentCache', () => ({
  shouldSkipAgent: jest.fn(() => false),
  setLastRun: jest.fn(),
}));

jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

// Cross-business donor cache is covered separately in collectCompetitorSocialPosts.donor.test.ts —
// force it to "no donor" here so these tests only exercise the own-business dedup cascade.
jest.mock('../lib/competitorDonor', () => ({ findDonorCandidates: jest.fn(async () => []) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { collectCompetitorSocialPosts } from '../routes/functions/collectCompetitorSocialPosts';
import { postContentHash } from '../lib/postContentHash';

const COMP = { id: 'c1', name: 'פר דרייר', not_relevant: false, tracking_status: 'approved', instagram_url: 'https://instagram.com/perdrier', facebook_url: null };

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function insertCalls() {
  return executeRawUnsafe.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO competitor_posts'));
}
function updateHealCalls() {
  return executeRawUnsafe.mock.calls.filter(([sql]) => String(sql).includes('content_hash = COALESCE'));
}

beforeEach(() => {
  jest.clearAllMocks();
  executeRawUnsafe.mockResolvedValue(undefined);
  (prisma.competitor.findMany as jest.Mock).mockResolvedValue([COMP]);
});

test('null external_post_id + matching content_hash updates the existing row instead of inserting', async () => {
  const hash = postContentHash('instagram', 'Big sale this weekend!', '2026-08-10T08:00:00.000Z');
  queryRawUnsafe.mockResolvedValueOnce([{
    id: 'existing-1', external_post_id: null, post_url: null,
    content_hash: hash, media_url: 'https://old.jpg', analyzed_at: '2026-08-01T00:00:00.000Z',
    posted_at: '2026-08-10T08:00:00.000Z',
  }]);
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    { caption: 'Big sale this weekend!', timestamp: Math.floor(new Date('2026-08-10T20:00:00.000Z').getTime() / 1000) },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(insertCalls()).toHaveLength(0);
  expect(updateHealCalls()).toHaveLength(1);
  expect(updateHealCalls()[0][1]).toBe('existing-1'); // WHERE id = $1
});

test('normalized post_url matches across tracking-param + trailing-slash variants', async () => {
  queryRawUnsafe.mockResolvedValueOnce([{
    id: 'existing-2', external_post_id: null, post_url: 'https://www.instagram.com/p/abc123/',
    content_hash: null, media_url: 'https://old.jpg', analyzed_at: '2026-08-01T00:00:00.000Z',
    posted_at: '2026-08-05T08:00:00.000Z',
  }]);
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    { url: 'https://www.instagram.com/p/abc123?utm_source=ig_web_copy_link', caption: 'unrelated caption drift' },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialPosts(req, mockRes());

  expect(insertCalls()).toHaveLength(0);
  expect(updateHealCalls()).toHaveLength(1);
  expect(updateHealCalls()[0][1]).toBe('existing-2');
});

test('caption-less posts never hash-collide — both insert as separate rows with a null content_hash', async () => {
  queryRawUnsafe.mockResolvedValueOnce([]); // no existing rows
  (runApifyActor as jest.Mock).mockResolvedValueOnce([
    { id: 'media-only-1', displayUrl: 'https://img1.jpg' },
    { id: 'media-only-2', displayUrl: 'https://img2.jpg' },
  ]);

  const req: any = { body: { businessProfileId: 'b1' } };
  await collectCompetitorSocialPosts(req, mockRes());

  const inserts = insertCalls();
  expect(inserts).toHaveLength(2);
  // content_hash is the last positional param ($13) on every insert call.
  for (const call of inserts) {
    expect(call[call.length - 1]).toBeNull();
  }
});
