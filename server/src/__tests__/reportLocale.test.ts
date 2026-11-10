// English / US-timezone path of the competitor report: locale resolution, period cut, PDF HTML, email, prompt.
// Hebrew output is covered by reportPdf / reportEmail / reportPeriod tests, which must keep passing unchanged.
jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn(), startCostTracking: jest.fn(), popCost: jest.fn() }));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/email', () => ({ sendEmail: jest.fn(async () => true) }));

import { localeOf, IL_LOCALE } from '../lib/locale';
import { reportPeriod } from '../lib/reportPeriod';
import { buildReportHtml, reportPeriodLabel } from '../lib/reportPdf/html';
import { reportPdfFilename } from '../lib/reportPdf';
import { buildReportEmail } from '../lib/reportEmail';
import { buildPrompt } from '../routes/functions/generateReport';

const HEBREW = /[֐-׿]/;
const NY = localeOf({ locale: 'en-US' });
const LA = localeOf({ locale: 'en-US', timezone: 'America/Los_Angeles' });
const iso = (p: { start: Date; end: Date }) => [p.start.toISOString(), p.end.toISOString()];

describe('localeOf', () => {
  it('keeps every business without an English locale on Hebrew / Israel time', () => {
    expect(localeOf(null)).toEqual(IL_LOCALE);
    expect(localeOf({ locale: null, timezone: null })).toEqual(IL_LOCALE);
    expect(localeOf({ locale: 'he-IL' })).toEqual(IL_LOCALE);
  });

  it('English defaults to US Eastern, takes a valid timezone and ignores a bad one', () => {
    expect(NY).toEqual({ lang: 'en', intl: 'en-US', tz: 'America/New_York' });
    expect(LA.tz).toBe('America/Los_Angeles');
    expect(localeOf({ locale: 'en-US', timezone: 'Mars/Phobos' }).tz).toBe('America/New_York');
  });
});

describe('reportPeriod in US timezones', () => {
  it('daily = yesterday in New York (EST, UTC-5)', () => {
    expect(iso(reportPeriod('daily', new Date('2026-11-10T13:00:00Z'), NY.tz)))
      .toEqual(['2026-11-09T05:00:00.000Z', '2026-11-10T05:00:00.000Z']);
  });

  it('daily uses the Los Angeles date while it is already tomorrow in UTC', () => {
    // 07:00Z on Nov 10 is 23:00 on Nov 9 in LA -> yesterday = Nov 8
    expect(iso(reportPeriod('daily', new Date('2026-11-10T07:00:00Z'), LA.tz)))
      .toEqual(['2026-11-08T08:00:00.000Z', '2026-11-09T08:00:00.000Z']);
  });

  it('daily spans 25h on the US DST-end day (2026-11-01)', () => {
    const p = reportPeriod('daily', new Date('2026-11-02T13:00:00Z'), NY.tz);
    expect(iso(p)).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
    expect((p.end.getTime() - p.start.getTime()) / 3600000).toBe(25);
  });

  it('weekly = last Sunday–Saturday in New York', () => {
    expect(iso(reportPeriod('weekly', new Date('2026-11-10T13:00:00Z'), NY.tz)))
      .toEqual(['2026-11-01T04:00:00.000Z', '2026-11-08T05:00:00.000Z']);
  });
});

describe('English period labels', () => {
  it('formats daily / weekly / monthly in the business timezone (end exclusive)', () => {
    expect(reportPeriodLabel('daily', '2026-11-07T05:00:00Z', '2026-11-08T05:00:00Z', NY)).toBe('Saturday, November 7, 2026');
    expect(reportPeriodLabel('weekly', '2026-11-01T04:00:00Z', '2026-11-08T05:00:00Z', NY)).toBe('November 1–7, 2026');
    expect(reportPeriodLabel('weekly', '2026-11-29T05:00:00Z', '2026-12-06T05:00:00Z', NY)).toBe('November 29 – December 5, 2026');
    expect(reportPeriodLabel('monthly', '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z', NY)).toBe('October 2026');
  });

  it('without a locale it is the Hebrew label', () => {
    expect(reportPeriodLabel('monthly', '2026-09-30T21:00:00Z', '2026-10-31T22:00:00Z')).toBe('אוקטובר 2026');
  });
});

// Synthetic English fixture exercising every section.
const weekly = {
  report_type: 'weekly',
  status: 'ready',
  period_start: '2026-11-01T04:00:00.000Z',
  period_end: '2026-11-08T05:00:00.000Z',
  created_date: '2026-11-08T13:00:00.000Z',
  data: {
    totals: { posts: 5, stories: 0, new_ads: 1, active_ads: 3, offers: 1, changes: 1, reviews: 4 },
    competitors: [{
      name: 'Rival Pizza', current_rating: 4.4, current_review_count: 210, followers_delta: 12,
      posts: { count: 5, total_engagement: 340, top: [{ platform: 'instagram', url: 'https://www.instagram.com/p/AAA/', caption: 'Two for one on Tuesdays', posted_at: '2026-11-03T18:00:00.000Z', likes: 120, comments: 7, offer: { details: '2 for 1' }, media_url: null, video_url: null }] },
      stories: { count: 0 },
      ads: {
        new_count: 1, active_count: 3, active_capped: false,
        new: [{ platform: 'facebook', title: 'Lunch deal', body: '20% off lunch this week', started_at: '2026-11-04T12:00:00.000Z', cta: 'Order now', link: 'https://example.com/lunch', offer: null }],
        active: [{ platform: 'instagram', title: '', body: '', started_at: '2026-10-20T12:00:00.000Z', link: null, offer: null }],
      },
      offers: { count: 1, items: [{ source: 'post', at: '2026-11-03T18:00:00.000Z', details: '2 for 1 on Tuesdays', urgency: 'This week only' }] },
      reviews: { count: 4, avg_rating: 3.25, themes: [{ theme: 'wait_time', total: 3, positive: 0, negative: 3 }], negative_samples: ['Waited 50 minutes for a pizza'] },
    }, { name: 'Quiet Cafe', posts: { count: 0 }, stories: { count: 0 }, ads: { new_count: 0, active_count: 0 }, offers: { count: 0 } }],
    own_reviews: { count: 2, avg_rating: 4.5, negative: 0, reply_rate: 100, themes: [{ theme: 'food_quality', total: 2, positive: 2, negative: 0 }] },
    changes: [{ summary: 'Rival Pizza added online ordering' }],
    limits: ['Stories are collected from Instagram only (not Facebook)'],
  },
  summary: {
    headline: 'Rival Pizza pushed a 2-for-1 offer and a new lunch ad',
    highlights: ['Rival Pizza posted 5 times'], reviews_summary: 'Their reviews mention slow service.',
    recommended_actions: ['Post your delivery times'],
    per_competitor: [{ name: 'Rival Pizza', summary: 'Five posts and one new ad.' }],
  },
};

describe('English report document', () => {
  const h = buildReportHtml(weekly, { businessName: "Joe's Pizza", locale: NY });

  it('is left-to-right English with no Hebrew anywhere', () => {
    expect(h).toContain('<html lang="en" dir="ltr">');
    expect(h.replace(/<style>[\s\S]*?<\/style>/, '')).not.toMatch(HEBREW); // the stylesheet keeps the Hebrew quote mark rule
  });

  it('has every section with English labels, US dates and readable topic names', () => {
    for (const s of ['Weekly competitor report', 'November 1–7, 2026', '2 competitors tracked', 'In one line', 'Highlights', 'What to do',
      'You vs. your competitors', 'Reviews', "Competitors' weak points", 'Wait time', 'Food quality', 'Review of',
      "Competitors' top posts", 'Instagram · 11/03 · 120 likes · 7 comments', 'Offers detected', 'In a post · 11/03',
      'New ads', 'Launched 11/04', 'Button: Order now', 'Ads still running', 'Running since 10/20', 'Ad without text',
      'Changes detected', 'By competitor', 'No activity this week: Quiet Cafe', 'About the data:', 'Generated 11/08/2026']) {
      expect(h.replace(/&#39;|&#x27;/g, "'")).toContain(s); // section titles are escaped, inline labels are not
    }
  });

  it('an empty period reads in English too', () => {
    const empty = buildReportHtml({ ...weekly, status: 'empty', summary: null }, { businessName: "Joe's Pizza", locale: NY });
    expect(empty).toContain('No new competitor activity detected this week — 3 of their ads are still running.');
    expect(empty.replace(/<style>[\s\S]*?<\/style>/, '')).not.toMatch(HEBREW);
  });

  it('names the PDF by the period start in the business timezone', () => {
    expect(reportPdfFilename(weekly, NY.tz)).toBe('cortexi-weekly-2026-11-01.pdf');
  });
});

describe('English report email', () => {
  const { subject, html } = buildReportEmail(weekly as any, "Joe's Pizza", true, NY);

  it('is left-to-right English with no Hebrew', () => {
    expect(subject).toBe("Weekly competitor report · Joe's Pizza · November 1–7, 2026");
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('text-align:left');
    expect(html).toContain('Competitor reviews');
    expect(html).toContain('The full report is attached as a PDF');
    expect(html).not.toMatch(HEBREW);
  });
});

describe('report prompt language', () => {
  const start = new Date(weekly.period_start);
  const end = new Date(weekly.period_end);

  it('asks for English and carries no Hebrew for an English business', () => {
    const p = buildPrompt('weekly', start, end, weekly.data, NY, "Joe's Pizza | Pizza | Austin");
    expect(p).toContain('ALL string values must be in English');
    expect(p).toContain("Business: Joe's Pizza | Pizza | Austin");
    expect(p).toContain('11/1/2026–11/7/2026');
    expect(p).not.toMatch(HEBREW);
  });

  it('is unchanged for a Hebrew business', () => {
    const p = buildPrompt('weekly', start, end, weekly.data);
    expect(p).toContain('ALL string values must be in Hebrew');
    expect(p).toContain('small Israeli business');
    expect(p).toContain('דוח שבועי');
    expect(p).not.toContain('Business:');
  });
});
