import { computeUrlEnrichmentMetrics } from '../services/metrics/KPIService';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: { $queryRawUnsafe: jest.fn() },
}));

const queryRaw = prisma.$queryRawUnsafe as jest.Mock;

const COMPETITOR = (overrides: Partial<{
  created_date: string; website_url: string | null; website_url_source: string | null;
  instagram_url: string | null; instagram_url_source: string | null;
  facebook_url: string | null; facebook_url_source: string | null;
  tiktok_url: string | null; tiktok_url_source: string | null;
  social_pages_crawled_at: string | null; manual_url_fields: string[] | null;
}>) => ({
  created_date: '2026-01-01T00:00:00.000Z', website_url: 'https://a.com', website_url_source: null,
  instagram_url: null, instagram_url_source: null,
  facebook_url: null, facebook_url_source: null,
  tiktok_url: null, tiktok_url_source: null,
  social_pages_crawled_at: null, manual_url_fields: [],
  ...overrides,
});

const RUN = (status: string | null) => ({ status });

beforeEach(() => jest.clearAllMocks());

describe('computeUrlEnrichmentMetrics (KAN-224)', () => {
  it('computes website fill rate within 24h from social_pages_crawled_at proximity to created_date', async () => {
    queryRaw
      .mockResolvedValueOnce([
        COMPETITOR({ website_url: 'https://a.com', social_pages_crawled_at: '2026-01-01T01:00:00.000Z' }), // within 24h
        COMPETITOR({ website_url: 'https://b.com', social_pages_crawled_at: '2026-01-05T00:00:00.000Z' }), // 4 days later
        COMPETITOR({ website_url: null }),
      ])
      .mockResolvedValueOnce([]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m.identified_count).toBe(3);
    expect(m.website_filled_count).toBe(2);
    expect(m.website_fill_rate_24h).toBeCloseTo(1 / 3);
  });

  it('splits social fill source mix between site-extract and SERP/Tavily', async () => {
    queryRaw
      .mockResolvedValueOnce([
        COMPETITOR({ instagram_url: 'https://instagram.com/a', instagram_url_source: 'site_extract' }),
        COMPETITOR({ facebook_url: 'https://facebook.com/b', facebook_url_source: 'serp' }),
        COMPETITOR({ tiktok_url: 'https://tiktok.com/c', tiktok_url_source: 'tavily' }),
      ])
      .mockResolvedValueOnce([]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m.social_fill_count).toBe(3);
    expect(m.social_from_site_extract).toBe(1);
    expect(m.social_from_site_extract_rate).toBeCloseTo(1 / 3);
  });

  it('computes precision as auto-filled fields the owner did not later edit or clear', async () => {
    queryRaw
      .mockResolvedValueOnce([
        COMPETITOR({ website_url_source: 'places', manual_url_fields: [] }),        // kept
        COMPETITOR({ instagram_url_source: 'site_extract', manual_url_fields: ['instagram_url'] }), // owner edited/cleared
      ])
      .mockResolvedValueOnce([]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m.auto_filled_field_count).toBe(2);
    expect(m.auto_filled_kept_count).toBe(1);
    expect(m.precision).toBeCloseTo(0.5);
  });

  it('computes empty-social rate from competitors with no social urls', async () => {
    queryRaw
      .mockResolvedValueOnce([
        COMPETITOR({}), // no social fields set
        COMPETITOR({ instagram_url: 'https://instagram.com/a' }),
      ])
      .mockResolvedValueOnce([]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m.empty_social_count).toBe(1);
    expect(m.empty_social_rate).toBe(0.5);
  });

  it('computes failed-run rate from automation_logs', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([RUN('success'), RUN('failed'), RUN('success')]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m.run_count).toBe(3);
    expect(m.failed_run_count).toBe(1);
    expect(m.failed_run_rate).toBeCloseTo(1 / 3);
  });

  it('returns all zeros with no data instead of dividing by zero', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const m = await computeUrlEnrichmentMetrics('tenant1', 30);

    expect(m).toMatchObject({
      website_fill_rate_24h: 0, social_from_site_extract_rate: 0,
      precision: 0, empty_social_rate: 0, failed_run_rate: 0,
    });
  });
});
