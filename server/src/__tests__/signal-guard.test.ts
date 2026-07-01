import { normSignalType, normRawOrigin, normReviewOrigin } from '../lib/signalGuard';

describe('signalGuard — normSignalType', () => {

  test('valid values pass through unchanged', () => {
    expect(normSignalType('web_search')).toBe('web_search');
    expect(normSignalType('social_mention')).toBe('social_mention');
    expect(normSignalType('social_review')).toBe('social_review');
    expect(normSignalType('competitor_social')).toBe('competitor_social');
    expect(normSignalType('custom_source')).toBe('custom_source');
    expect(normSignalType('social_trend')).toBe('social_trend');
  });

  test('invalid value is normalized to "custom_source" and warns', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normSignalType('social_post')).toBe('custom_source');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('social_post'));
    warnSpy.mockRestore();
  });

  test('context string is included in the warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    normSignalType('bad_type', 'collectSocialSignals');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('collectSocialSignals'));
    warnSpy.mockRestore();
  });

});

describe('signalGuard — normRawOrigin', () => {

  test('valid values pass through unchanged', () => {
    expect(normRawOrigin('tavily')).toBe('tavily');
    expect(normRawOrigin('apify')).toBe('apify');
    expect(normRawOrigin('google_places')).toBe('google_places');
    expect(normRawOrigin('instagram_graph_api')).toBe('instagram_graph_api');
    expect(normRawOrigin('llm')).toBe('llm');
    expect(normRawOrigin('manual')).toBe('manual');
    expect(normRawOrigin('webhook')).toBe('webhook');
  });

  test('invalid value is normalized to "manual" and warns', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normRawOrigin('unknown_origin')).toBe('manual');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown_origin'));
    warnSpy.mockRestore();
  });

});

describe('signalGuard — normReviewOrigin', () => {

  test('valid values pass through unchanged', () => {
    expect(normReviewOrigin('google_places')).toBe('google_places');
    expect(normReviewOrigin('google_business_api')).toBe('google_business_api');
    expect(normReviewOrigin('tavily')).toBe('tavily');
    expect(normReviewOrigin('apify')).toBe('apify');
    expect(normReviewOrigin('manual')).toBe('manual');
  });

  test('invalid value is normalized to "manual" and warns', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normReviewOrigin('bad_origin')).toBe('manual');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad_origin'));
    warnSpy.mockRestore();
  });

});
