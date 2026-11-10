/**
 * Unit tests — Meta ads via Apify (primary) with SearchAPI fallback.
 * Covers: Apify success -> used as-is, no SearchAPI call; Apify empty/unavailable
 * -> falls back to SearchAPI meta_ad_library.
 */
import '../__tests__/testEnv';

jest.mock('../lib/apify', () => ({
  runApifyActor: jest.fn(),
  hasApifyKey: jest.fn(),
}));

import { runApifyActor, hasApifyKey } from '../lib/apify';
import { searchAllAds, searchMetaAdsViaApify, facebookPageUrl } from '../lib/searchapi';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SEARCHAPI_API_KEY = 'test-searchapi-key';
});

function fetchJson(data: any) {
  return { ok: true, json: async () => data };
}

describe('searchMetaAdsViaApify', () => {
  it('maps Apify actor output onto AdResult', async () => {
    (runApifyActor as jest.Mock).mockResolvedValue([{
      adArchiveID: '999',
      pageName: 'Acme Co',
      isActive: true,
      startDate: 1700000000,
      publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
      snapshot: {
        title: 'Big Sale',
        body: 'Save 20% today',
        ctaText: 'Shop Now',
        linkUrl: 'https://acme.example/sale',
      },
    }]);

    const result = await searchMetaAdsViaApify('https://facebook.com/acmeco');

    expect(runApifyActor).toHaveBeenCalledWith(
      'apify~facebook-ads-scraper',
      expect.objectContaining({ startUrls: [{ url: 'https://facebook.com/acmeco' }] }),
      expect.anything(), expect.anything(), expect.anything(),
    );
    expect(result).toEqual([expect.objectContaining({
      platform: 'instagram',
      title: 'Big Sale',
      body: 'Save 20% today',
      cta: 'Shop Now',
      link: 'https://acme.example/sale',
      page_name: 'Acme Co',
      external_ad_id: '999',
      is_active: true,
    })]);
  });

  it('catalog video ad: skips {{template}} titles and uses the video preview frame as the image', async () => {
    (runApifyActor as jest.Mock).mockResolvedValue([{
      adArchiveID: '1000', isActive: true, publisherPlatform: ['FACEBOOK'],
      snapshot: {
        title: '{{product.name}}', body: { text: '{{product.brand}}' },
        cards: [{ title: 'Tasting menu', body: 'Book a table' }],
        videos: [{ videoHdUrl: 'https://video.example/ad.mp4', videoPreviewImageUrl: 'https://img.example/frame.jpg' }],
      },
    }]);

    const [ad] = await searchMetaAdsViaApify('https://facebook.com/acmeco');

    expect(ad).toEqual(expect.objectContaining({
      title: 'Tasting menu',
      body: 'Book a table',
      media_url: 'https://img.example/frame.jpg',
      video_url: 'https://video.example/ad.mp4',
    }));
  });

  it('returns [] when Apify returns nothing', async () => {
    (runApifyActor as jest.Mock).mockResolvedValue([]);
    expect(await searchMetaAdsViaApify('https://facebook.com/acmeco')).toEqual([]);
  });

  it('filters out the "no ads" error-placeholder shape instead of mapping it into a fake ad', async () => {
    (runApifyActor as jest.Mock).mockResolvedValue([
      { url: 'https://facebook.com/acmeco', error: 'no_items', errorDescription: 'Empty or private data for provided input' },
    ]);
    expect(await searchMetaAdsViaApify('https://facebook.com/acmeco')).toEqual([]);
  });

  it('filters out the empty-results-wrapper "no ads" shape instead of mapping it into a fake ad', async () => {
    // Confirmed live: some pages return this shape (no `error` key) instead of the
    // error-placeholder above when they have zero active ads.
    (runApifyActor as jest.Mock).mockResolvedValue([
      { inputUrl: 'https://facebook.com/acmeco', pageInfo: {}, isResultComplete: true, results: [], totalCount: 0 },
    ]);
    expect(await searchMetaAdsViaApify('https://facebook.com/acmeco')).toEqual([]);
  });
});

describe('searchAllAds priority', () => {
  it('uses Apify results and skips SearchAPI when Apify succeeds', async () => {
    (hasApifyKey as jest.Mock).mockReturnValue(true);
    (runApifyActor as jest.Mock).mockResolvedValue([{
      adArchiveID: '1', isActive: true, publisherPlatform: ['FACEBOOK'],
      snapshot: { title: 't', body: 'b', ctaText: 'c', linkUrl: 'l' },
    }]);

    const ads = await searchAllAds('Acme', 'cafe', 'TLV', 'acmeco', 'https://facebook.com/acmeco');

    expect(ads).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled(); // SearchAPI never hit
  });

  it('scrapes the page itself when the stored link is an album of it', async () => {
    (hasApifyKey as jest.Mock).mockReturnValue(true);
    (runApifyActor as jest.Mock).mockResolvedValue([]);
    await searchAllAds('Acme', 'cafe', 'TLV', null, 'https://www.facebook.com/acmeco/albums/111222333444555/');
    expect((runApifyActor as jest.Mock).mock.calls[0][1].startUrls).toEqual([{ url: 'https://www.facebook.com/acmeco' }]);
  });

  it('falls back to SearchAPI meta_ad_library when Apify is unavailable', async () => {
    (hasApifyKey as jest.Mock).mockReturnValue(false);
    mockFetch.mockResolvedValueOnce(fetchJson({
      ads: [{
        ad_archive_id: '2', is_active: true, publisher_platform: ['FACEBOOK'],
        snapshot: { title: 'from searchapi', body: 'b', cta_text: 'c' },
      }],
    }));

    const ads = await searchAllAds('Acme', 'cafe', 'TLV', 'acmeco', 'https://facebook.com/acmeco');

    expect(runApifyActor).not.toHaveBeenCalled();
    expect(ads).toEqual([expect.objectContaining({ title: 'from searchapi' })]);
  });
});

describe('facebookPageUrl', () => {
  it.each([
    ['https://www.facebook.com/acmeco/albums/111222333444555/', 'https://www.facebook.com/acmeco'],
    ['https://www.facebook.com/acmeco/?fref=ts', 'https://www.facebook.com/acmeco'],
    ['facebook.com/acmeco', 'https://www.facebook.com/acmeco'],
    ['https://m.facebook.com/acmeco/photos/a.1/2/', 'https://www.facebook.com/acmeco'],
    ['https://www.facebook.com/100000000000001/posts/some-slug/222333444555666', 'https://www.facebook.com/100000000000001'],
    ['https://www.facebook.com/profile.php?id=100000000000002&sk=about', 'https://www.facebook.com/profile.php?id=100000000000002'],
    ['https://www.facebook.com/permalink.php?story_fbid=123&id=100000000000002', 'https://www.facebook.com/profile.php?id=100000000000002'],
    ['https://www.facebook.com/p/Acme-Cafe-100000000000002/', 'https://www.facebook.com/100000000000002'],
    ['https://www.facebook.com/pages/Acme-Cafe/123456789012', 'https://www.facebook.com/123456789012'],
    ['https://www.facebook.com/share/1AbCdEf/', 'https://www.facebook.com/share/1AbCdEf/'],
    ['not a url', 'not a url'],
  ])('%s -> %s', (input, expected) => {
    expect(facebookPageUrl(input)).toBe(expected);
  });
});
