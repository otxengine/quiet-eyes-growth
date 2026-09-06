/**
 * Unit tests — computeContentTrendStats / normalizeContentTrendsInsight /
 * deriveCopySummary (pure functions, no DB/LLM calls).
 */
import {
  computeContentTrendStats, normalizeContentTrendsInsight, deriveCopySummary,
  ContentTrendPostLike, ContentTrendsInsight,
} from '../lib/contentTrendStats';

describe('computeContentTrendStats', () => {
  test('returns null when posts is empty', () => {
    expect(computeContentTrendStats([])).toBeNull();
  });

  test('tallies content_pillar/audience_action_driver/platform, sorted desc', () => {
    const posts: ContentTrendPostLike[] = [
      { platform: 'instagram', content_pillar: 'מבצעים', audience_action_driver: 'תיוג חבר' },
      { platform: 'instagram', content_pillar: 'מבצעים', audience_action_driver: 'שיתוף' },
      { platform: 'facebook', content_pillar: 'הומור', audience_action_driver: 'תיוג חבר' },
    ];
    const result = computeContentTrendStats(posts)!;
    expect(result.total_posts).toBe(3);
    expect(result.content_pillar_breakdown).toEqual([{ value: 'מבצעים', count: 2 }, { value: 'הומור', count: 1 }]);
    expect(result.audience_action_driver_breakdown).toEqual([{ value: 'תיוג חבר', count: 2 }, { value: 'שיתוף', count: 1 }]);
    expect(result.platform_breakdown).toEqual([{ value: 'instagram', count: 2 }, { value: 'facebook', count: 1 }]);
  });

  test('ignores null/missing content_pillar and audience_action_driver', () => {
    const posts: ContentTrendPostLike[] = [
      { platform: 'instagram', content_pillar: null, audience_action_driver: undefined },
      { platform: 'instagram', content_pillar: 'מבצעים', audience_action_driver: null },
    ];
    const result = computeContentTrendStats(posts)!;
    expect(result.content_pillar_breakdown).toEqual([{ value: 'מבצעים', count: 1 }]);
    expect(result.audience_action_driver_breakdown).toEqual([]);
  });
});

describe('normalizeContentTrendsInsight', () => {
  test('returns null for non-object input', () => {
    expect(normalizeContentTrendsInsight(null)).toBeNull();
    expect(normalizeContentTrendsInsight('a string')).toBeNull();
  });

  test('fills every topic key, defaulting missing/non-string values to null', () => {
    const raw = { content_themes: 'נושא', hook_patterns: 123, extra_junk: 'ignored' };
    const result = normalizeContentTrendsInsight(raw)!;
    expect(result.content_themes).toBe('נושא');
    expect(result.hook_patterns).toBeNull();
    expect(result.engagement_drivers).toBeNull();
    expect(result.improvement_opportunity).toBeNull();
  });

  test('returns null when every topic came back empty', () => {
    expect(normalizeContentTrendsInsight({ content_themes: null, hook_patterns: '' })).toBeNull();
  });
});

describe('deriveCopySummary', () => {
  test('returns null for null insight', () => {
    expect(deriveCopySummary(null)).toBeNull();
  });

  test('joins content_themes, hook_patterns, engagement_drivers (skipping nulls)', () => {
    const insight: ContentTrendsInsight = {
      content_themes: 'א', hook_patterns: 'ב', engagement_drivers: null,
      visual_style: 'ג', platform_performance: 'ד', improvement_opportunity: 'ה',
    };
    expect(deriveCopySummary(insight)).toBe('א ב');
  });

  test('returns null when the copy-related topics are all null', () => {
    const insight: ContentTrendsInsight = {
      content_themes: null, hook_patterns: null, engagement_drivers: null,
      visual_style: 'ג', platform_performance: null, improvement_opportunity: null,
    };
    expect(deriveCopySummary(insight)).toBeNull();
  });
});
