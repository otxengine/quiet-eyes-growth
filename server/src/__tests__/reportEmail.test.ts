const sendEmail = jest.fn(async () => true);
jest.mock('../lib/email', () => ({ sendEmail: (...a: any[]) => (sendEmail as any)(...a) }));

import { reportRecipients, buildReportEmail, periodLabel, sendReportEmail } from '../lib/reportEmail';

const weekly = {
  report_type: 'weekly',
  period_start: new Date('2026-10-31T22:00:00.000Z'),
  period_end: new Date('2026-11-07T22:00:00.000Z'),
  data: {
    totals: { posts: 18, stories: 220, new_ads: 1, offers: 10, changes: 0, reviews: 66 },
    competitors: [
      { name: 'יפו-תל אביב', posts: { count: 4, total_engagement: 662 }, stories: { count: 26 }, ads: { new_count: 0, active_count: 0 }, offers: { count: 0 }, reviews: { count: 4, avg_rating: 5 } },
      { name: 'Evil <img src=x onerror=alert(1)>', posts: { count: 1, total_engagement: 10 }, stories: { count: 0 }, ads: { new_count: 0, active_count: 0 }, offers: { count: 0 } },
    ],
    own_reviews: { count: 7, avg_rating: 4.29, negative: 1, reply_rate: 0 },
    changes: [],
    limits: ['סטוריז נאספים מאינסטגרם בלבד'],
  },
  summary: {
    headline: 'לונל הובילה את השבוע <script>alert(1)</script>',
    highlights: ['a'], reviews_summary: 'סיכום ביקורות', recommended_actions: ['פעולה 1'],
    per_competitor: [{ name: 'לונל', summary: 'פרסמה 3 פוסטים' }],
  },
};

describe('reportRecipients', () => {
  it('splits, trims and drops anything that is not an address', () => {
    expect(reportRecipients(' a@x.com, b@y.co.il ,not-an-email,, c@z.io')).toEqual(['a@x.com', 'b@y.co.il', 'c@z.io']);
    expect(reportRecipients('')).toEqual([]);
    expect(reportRecipients(undefined)).toEqual([]);
  });
});

describe('periodLabel', () => {
  it('formats each report type in Israel time', () => {
    expect(periodLabel('daily', new Date('2026-11-06T22:00:00Z'), new Date('2026-11-07T22:00:00Z'))).toBe('7 בנובמבר 2026');
    expect(periodLabel('weekly', weekly.period_start, weekly.period_end)).toBe('1–7 בנובמבר 2026');
    expect(periodLabel('monthly', new Date('2026-09-30T21:00:00Z'), new Date('2026-10-31T22:00:00Z'))).toBe('אוקטובר 2026');
  });
});

describe('buildReportEmail', () => {
  const { subject, html } = buildReportEmail(weekly, 'A.K.A');

  it('names the report type, business and period in the subject', () => {
    expect(subject).toBe('דוח מתחרים שבועי · A.K.A · 1–7 בנובמבר 2026');
  });

  it('escapes report text — scraped names and LLM output are untrusted', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes the sections the report has and skips the ones it lacks', () => {
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('סיכום ביקורות');
    expect(html).toContain('פעולות מומלצות');
    expect(html).toContain('662');
    expect(html).toContain('שיעור מענה 0%');
    expect(html).not.toContain('הפעילות שלכם'); // own_summary is monthly-only
    expect(html).not.toContain('שינויים שזוהו'); // no changes this period
  });
});

describe('sendReportEmail', () => {
  const env = process.env.REPORT_EMAIL_RECIPIENTS;
  afterEach(() => { process.env.REPORT_EMAIL_RECIPIENTS = env; sendEmail.mockClear(); });

  it('sends one email to the whole list', async () => {
    process.env.REPORT_EMAIL_RECIPIENTS = 'a@x.com,b@y.com,c@z.com';
    await expect(sendReportEmail(weekly, 'A.K.A')).resolves.toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as any)[0].to).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('does nothing when the list is not configured', async () => {
    delete process.env.REPORT_EMAIL_RECIPIENTS;
    await expect(sendReportEmail(weekly, 'A.K.A')).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
