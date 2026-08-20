/**
 * Unit test — collectOwnSocialProfile Facebook-page-id fallback.
 * OAuth-connected businesses get facebook_page_id/facebook_page_token but never
 * facebook_url, so without this fallback they'd never get scraped at all.
 */

const businessSocialProfileFindUnique = jest.fn();
const businessSocialProfileUpsert = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn() },
    businessSocialProfile: {
      findUnique: (...args: any[]) => businessSocialProfileFindUnique(...args),
      upsert: (...args: any[]) => businessSocialProfileUpsert(...args),
    },
  },
}));

jest.mock('../lib/apify', () => ({
  hasApifyKey: jest.fn(() => true),
  runApifyActor: jest.fn(async () => []),
}));

jest.mock('../lib/s3', () => ({ isS3Configured: jest.fn(() => false), uploadImageFromUrl: jest.fn() }));
jest.mock('../lib/agentCache', () => ({ shouldSkipAgent: jest.fn(() => false), setLastRun: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn(async () => {}) }));

import { prisma } from '../db';
import { runApifyActor } from '../lib/apify';
import { collectOwnSocialProfile } from '../routes/functions/collectOwnSocialProfile';

const mockRunApifyActor = runApifyActor as jest.Mock;

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunApifyActor.mockResolvedValue([]);
  businessSocialProfileFindUnique.mockResolvedValue(null);
  businessSocialProfileUpsert.mockResolvedValue({});
});

test('scrapes Facebook via a derived facebook.com/{page_id} URL when facebook_url is absent', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1', instagram_url: null, facebook_url: null, facebook_page_id: '123456789',
  });

  const res = mockRes();
  await collectOwnSocialProfile({ body: { businessProfileId: 'b1', force: true } } as any, res);

  const fbCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'NZ2v1fqLfaN2UBYIx');
  expect(fbCall).toBeTruthy();
  expect(fbCall![1]).toMatchObject({ profileUrls: ['https://www.facebook.com/123456789'] });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ saved: expect.any(Number) }));
  expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'no_social_url' }));
});

test('skips entirely when neither facebook_url nor facebook_page_id nor instagram_url is set', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1', instagram_url: null, facebook_url: null, facebook_page_id: null,
  });

  const res = mockRes();
  await collectOwnSocialProfile({ body: { businessProfileId: 'b1', force: true } } as any, res);

  expect(mockRunApifyActor).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ saved: 0, skipped: true, reason: 'no_social_url' }));
});

test('a manually-entered facebook_url takes priority over the derived page-id URL', async () => {
  (prisma.businessProfile.findUnique as jest.Mock).mockResolvedValue({
    id: 'b1', instagram_url: null, facebook_url: 'https://facebook.com/my-vanity-slug', facebook_page_id: '123456789',
  });

  const res = mockRes();
  await collectOwnSocialProfile({ body: { businessProfileId: 'b1', force: true } } as any, res);

  const fbCall = mockRunApifyActor.mock.calls.find(([actorId]) => actorId === 'NZ2v1fqLfaN2UBYIx');
  expect(fbCall![1]).toMatchObject({ profileUrls: ['https://facebook.com/my-vanity-slug'] });
});
