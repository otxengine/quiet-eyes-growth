import './testEnv';

jest.mock('../lib/apify',  () => ({ runApifyActor: jest.fn(), hasApifyKey: jest.fn() }));
jest.mock('../lib/tavily', () => ({ tavilySearch: jest.fn() }));

import { runApifyActor, hasApifyKey } from '../lib/apify';
import { tavilySearch } from '../lib/tavily';
import { fetchSocialPageAbout } from '../lib/fetchSocialPageAbout';

const mockRunApifyActor = runApifyActor as jest.Mock;
const mockHasApifyKey   = hasApifyKey as jest.Mock;
const mockTavilySearch  = tavilySearch as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockHasApifyKey.mockReturnValue(true);
  mockTavilySearch.mockResolvedValue([]);
});

describe('fetchSocialPageAbout', () => {
  it('returns [] when no urls are given', async () => {
    expect(await fetchSocialPageAbout({})).toEqual([]);
    expect(mockRunApifyActor).not.toHaveBeenCalled();
  });

  it('scrapes each platform with the correct Apify actor (AC2)', async () => {
    mockRunApifyActor.mockImplementation((actorId: string) => {
      if (actorId === 'apify~instagram-scraper') return Promise.resolve([{ biography: 'IG bio', username: 'biz' }]);
      if (actorId === 'clockworks~tiktok-profile-scraper') return Promise.resolve([{ authorMeta: { signature: 'TikTok bio', nickName: 'biz' } }]);
      if (actorId === 'apify~facebook-pages-scraper') return Promise.resolve([{ about: 'FB about', pageName: 'Biz' }]);
      return Promise.resolve([]);
    });

    const result = await fetchSocialPageAbout({
      facebookUrl: 'https://facebook.com/biz',
      instagramUrl: 'https://instagram.com/biz',
      tiktokUrl: 'https://tiktok.com/@biz',
    });

    expect(result).toHaveLength(3);
    expect(result.find(r => r.platform === 'instagram')?.aboutText).toBe('IG bio');
    expect(result.find(r => r.platform === 'tiktok')?.aboutText).toBe('TikTok bio');
    expect(result.find(r => r.platform === 'facebook')?.aboutText).toBe('FB about');
  });

  it('soft-fails per platform — one platform erroring does not block the others (AC4)', async () => {
    mockRunApifyActor.mockImplementation((actorId: string) => {
      if (actorId === 'apify~instagram-scraper') return Promise.reject(new Error('actor timeout'));
      if (actorId === 'clockworks~tiktok-profile-scraper') return Promise.resolve([{ authorMeta: { signature: 'TikTok bio' } }]);
      return Promise.resolve([]);
    });

    const result = await fetchSocialPageAbout({
      instagramUrl: 'https://instagram.com/biz',
      tiktokUrl: 'https://tiktok.com/@biz',
    });

    expect(result).toEqual([{ platform: 'tiktok', aboutText: 'TikTok bio', pageName: undefined, profileUrl: 'https://tiktok.com/@biz', raw: { authorMeta: { signature: 'TikTok bio' } } }]);
  });

  it('never invents — returns [] when Apify and Tavily both yield nothing', async () => {
    mockRunApifyActor.mockResolvedValue([]);
    mockTavilySearch.mockResolvedValue([]);

    const result = await fetchSocialPageAbout({ instagramUrl: 'https://instagram.com/biz' });
    expect(result).toEqual([]);
  });

  it('falls back to Tavily when Apify yields nothing (AC5)', async () => {
    mockRunApifyActor.mockResolvedValue([]);
    mockTavilySearch.mockResolvedValue([{ content: 'Tavily snippet about biz' }]);

    const result = await fetchSocialPageAbout({ instagramUrl: 'https://instagram.com/biz' });
    expect(result).toEqual([{ platform: 'instagram', aboutText: 'Tavily snippet about biz', profileUrl: 'https://instagram.com/biz', raw: { content: 'Tavily snippet about biz' } }]);
  });

  it('skips Apify when a cache entry is within the TTL (AC7)', async () => {
    const cached = {
      platform: 'instagram' as const,
      aboutText: 'cached bio',
      profileUrl: 'https://instagram.com/biz',
      scrapedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days old
    };

    const result = await fetchSocialPageAbout(
      { instagramUrl: 'https://instagram.com/biz' },
      { cache: [cached], ttlDays: 14 },
    );

    expect(result).toEqual([cached]);
    expect(mockRunApifyActor).not.toHaveBeenCalled();
  });

  it('re-scrapes when the cache entry is older than the TTL', async () => {
    const stale = {
      platform: 'instagram' as const,
      aboutText: 'old bio',
      profileUrl: 'https://instagram.com/biz',
      scrapedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days old
    };
    mockRunApifyActor.mockResolvedValue([{ biography: 'fresh bio' }]);

    const result = await fetchSocialPageAbout(
      { instagramUrl: 'https://instagram.com/biz' },
      { cache: [stale], ttlDays: 14 },
    );

    expect(result[0].aboutText).toBe('fresh bio');
    expect(mockRunApifyActor).toHaveBeenCalled();
  });

  it('forceRegenerate bypasses a fresh cache entry', async () => {
    const cached = {
      platform: 'instagram' as const,
      aboutText: 'cached bio',
      profileUrl: 'https://instagram.com/biz',
      scrapedAt: new Date().toISOString(),
    };
    mockRunApifyActor.mockResolvedValue([{ biography: 'fresh bio' }]);

    const result = await fetchSocialPageAbout(
      { instagramUrl: 'https://instagram.com/biz' },
      { cache: [cached], forceRegenerate: true },
    );

    expect(result[0].aboutText).toBe('fresh bio');
    expect(mockRunApifyActor).toHaveBeenCalled();
  });

  it('skips Apify entirely when no key is set and falls back to Tavily (AC3/AC5)', async () => {
    mockHasApifyKey.mockReturnValue(false);
    mockTavilySearch.mockResolvedValue([{ content: 'seo snippet' }]);

    const result = await fetchSocialPageAbout({ facebookUrl: 'https://facebook.com/biz' });

    expect(mockRunApifyActor).not.toHaveBeenCalled();
    expect(result[0].aboutText).toBe('seo snippet');
  });
});
