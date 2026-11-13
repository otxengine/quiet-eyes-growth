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
    expect(html).toContain('&lt;script&gt;');
  });

  it('is short: masthead, headline, non-zero KPI numbers and the PDF pointer', () => {
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('Cortexi · A.K.A');
    expect(html).toContain('דוח מתחרים שבועי');
    expect(html).toContain('הדוח המלא מצורף כקובץ PDF');
    expect(html).toContain('>18<'); // posts
    expect(html).toContain('>220<'); // stories
    expect(html).toContain('ביקורות על מתחרים');
    expect(html).not.toContain('>66<'); // totals.reviews also counts our own; the strip is competitors only
    expect(html).toContain('>4<');
    expect(html).not.toContain('שינויים שזוהו'); // zero KPIs are left out of the email
    // none of the old long-form sections
    for (const gone of ['פעולות מומלצות', 'עיקרי התקופה', 'לפי מתחרה', 'המספרים', 'סיכום ביקורות', 'מגבלות המידע', '<img']) {
      expect(html).not.toContain(gone);
    }
  });

  it('shows the running-ads KPI', () => {
    const { html: h } = buildReportEmail({ ...weekly, data: { ...weekly.data, totals: { ...weekly.data.totals, active_ads: 5 } } } as any, 'A.K.A');
    expect(h).toContain('מודעות פעילות');
    expect(h).toContain('>5<');
  });
});

describe('account-less Free plan', () => {
  const EN = { lang: 'en' as const, intl: 'en-US', tz: 'America/New_York' };
  const customer = (free: any) => ({ unsubscribeUrl: 'https://app.example.com/u', free });
  const info = { total: 3, manageUrl: 'https://app.example.com/en/start?t=tok', upgradeUrl: 'https://app.example.com/sign-up?briefing=1' };

  it('numbers the report and links to change competitors, upgrade and one unsubscribe for both', () => {
    const { html } = buildReportEmail(weekly, 'Joe\'s Pizza', false, EN, customer({ ...info, number: 1, last: false }));
    expect(html).toContain('Free report 1 of 3');
    expect(html).toContain('href="https://app.example.com/en/start?t=tok"');
    expect(html).toContain('>Change competitors<');
    expect(html).toContain('>Upgrade<');
    expect(html).toContain('>Unsubscribe from both<');
    expect(html).toContain('and the Cortexi newsletter');
    expect(html).not.toContain('last free report');
  });

  it('the third report says it is the last, offers the upgrade and no competitor link', () => {
    const { html } = buildReportEmail(weekly, 'Joe\'s Pizza', false, EN, customer({ ...info, number: 3, last: true, manageUrl: null }));
    expect(html).toContain('Free report 3 of 3');
    expect(html).toContain('This is your last free report');
    expect(html).toContain('>Keep my reports<');
    expect(html).not.toContain('Change competitors');
    expect(html).toContain('Your free reports end with this one');
    expect(html).toContain('>Unsubscribe<');
  });

  it('every other customer email is unchanged', () => {
    const { html } = buildReportEmail(weekly, 'Joe\'s Pizza', false, EN, { unsubscribeUrl: 'https://app.example.com/u' });
    expect(html).not.toContain('Free report');
    expect(html).not.toContain('Upgrade');
    expect(html).toContain('is subscribed to Cortexi competitor reports.');
  });
});

describe('sendReportEmail', () => {
  const env = process.env.REPORT_EMAIL_RECIPIENTS;
  afterEach(() => { process.env.REPORT_EMAIL_RECIPIENTS = env; sendEmail.mockClear(); });

  it('sends one email to the whole list', async () => {
    process.env.REPORT_EMAIL_RECIPIENTS = 'a@x.com,b@y.com,c@z.com';
    await expect(sendReportEmail(weekly, 'A.K.A')).resolves.toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = (sendEmail.mock.calls[0] as any)[0];
    expect(arg.to).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
    expect(arg.attachments).toBeUndefined();
  });

  it('attaches the PDF as base64 under its filename', async () => {
    process.env.REPORT_EMAIL_RECIPIENTS = 'a@x.com';
    const pdf = Buffer.from('%PDF-1.4 test');
    await sendReportEmail(weekly, 'A.K.A', { filename: 'cortexi-weekly-2026-11-01.pdf', content: pdf });
    expect((sendEmail.mock.calls[0] as any)[0].attachments).toEqual([
      { filename: 'cortexi-weekly-2026-11-01.pdf', content: pdf.toString('base64') },
    ]);
  });

  it('does nothing when the list is not configured', async () => {
    delete process.env.REPORT_EMAIL_RECIPIENTS;
    await expect(sendReportEmail(weekly, 'A.K.A')).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('PDF wording', () => {
  it('only says the PDF is attached when it is', () => {
    expect(buildReportEmail(weekly, 'A.K.A').html).toContain('מצורף כקובץ PDF');
    expect(buildReportEmail(weekly, 'A.K.A', false).html).not.toContain('מצורף כקובץ PDF');
  });
});
