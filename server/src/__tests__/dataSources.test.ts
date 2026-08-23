import { parseKeywords, parseUrls, buildKeywordQueries, buildUrlQueries } from '../lib/dataSources';

// ── parseKeywords ──────────────────────────────────────────────────────────────

describe('parseKeywords', () => {
  test('splits comma-separated keywords and trims whitespace', () => {
    expect(parseKeywords({ custom_keywords: 'pizza, burger ,falafel' }))
      .toEqual(['pizza', 'burger', 'falafel']);
  });

  test('filters empty strings after trim', () => {
    expect(parseKeywords({ custom_keywords: 'kw1,,  ,kw2' }))
      .toEqual(['kw1', 'kw2']);
  });

  test('returns [] when custom_keywords is null', () => {
    expect(parseKeywords({ custom_keywords: null })).toEqual([]);
  });

  test('returns [] when custom_keywords is undefined', () => {
    expect(parseKeywords({})).toEqual([]);
  });
});

// ── parseUrls ─────────────────────────────────────────────────────────────────

describe('parseUrls', () => {
  test('splits newline-separated URLs and trims whitespace', () => {
    expect(parseUrls({ custom_urls: 'https://a.com\nhttps://b.com\n' }))
      .toEqual(['https://a.com', 'https://b.com']);
  });

  test('filters blank lines', () => {
    expect(parseUrls({ custom_urls: 'https://a.com\n\n  \nhttps://b.com' }))
      .toEqual(['https://a.com', 'https://b.com']);
  });

  test('returns [] when custom_urls is null', () => {
    expect(parseUrls({ custom_urls: null })).toEqual([]);
  });
});

// ── buildKeywordQueries ────────────────────────────────────────────────────────

describe('buildKeywordQueries', () => {
  test('appends city string to each keyword', () => {
    expect(buildKeywordQueries({ custom_keywords: 'pizza, burger' }, 'Tel Aviv'))
      .toEqual(['pizza Tel Aviv', 'burger Tel Aviv']);
  });

  test('returns [] when no custom_keywords', () => {
    expect(buildKeywordQueries({ custom_keywords: null }, 'Tel Aviv')).toEqual([]);
  });
});

// ── buildUrlQueries ────────────────────────────────────────────────────────────

describe('buildUrlQueries', () => {
  test('non-social URL → site:<domain> "<name>" query', () => {
    const profile = { custom_urls: 'https://rest.co.il/reviews' };
    expect(buildUrlQueries(profile, 'My Biz'))
      .toContain('site:rest.co.il "My Biz"');
  });

  test('www is stripped from domain', () => {
    const profile = { custom_urls: 'https://www.zap.co.il' };
    expect(buildUrlQueries(profile, 'My Biz'))
      .toContain('site:zap.co.il "My Biz"');
  });

  test('instagram URL → "<name>" instagram query', () => {
    const profile = { custom_urls: 'https://www.instagram.com/mybiz' };
    expect(buildUrlQueries(profile, 'My Biz'))
      .toContain('"My Biz" instagram');
  });

  test('facebook URL → "<name>" facebook query', () => {
    const profile = { custom_urls: 'https://www.facebook.com/mybiz' };
    expect(buildUrlQueries(profile, 'My Biz'))
      .toContain('"My Biz" facebook');
  });

  test('invalid URL is silently dropped', () => {
    const profile = { custom_urls: 'not-a-url\nhttps://valid.com' };
    const queries = buildUrlQueries(profile, 'Biz');
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('valid.com');
  });

  test('returns [] when custom_urls is null', () => {
    expect(buildUrlQueries({ custom_urls: null }, 'Biz')).toEqual([]);
  });

  test('multiple URLs each generate one query', () => {
    const profile = { custom_urls: 'https://a.com\nhttps://b.com\nhttps://instagram.com/x' };
    const queries = buildUrlQueries(profile, 'Biz');
    expect(queries).toHaveLength(3);
  });
});
