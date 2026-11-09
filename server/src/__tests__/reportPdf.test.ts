// The report PDF: the HTML builder (no browser) and a real-Chromium smoke test when one is installed.
// All fixtures are synthetic.
import fs from 'fs';
import { buildReportHtml, cleanName, hebrewPeriodLabel, reportKpis, reportMediaUrls, tx } from '../lib/reportPdf/html';
import { reportPdfFilename, renderReportPdf, videoHref } from '../lib/reportPdf';

const S3_IMG = 'https://media-bucket.s3.us-east-1.amazonaws.com/competitor-posts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg';
const S3_VID = 'https://media-bucket.s3.us-east-1.amazonaws.com/competitor-ads/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4';

const post = (over: any = {}) => ({
  platform: 'instagram', url: 'https://www.instagram.com/p/AAA/', caption: 'קפה חדש בתפריט', posted_at: '2026-11-08T08:09:06.000Z',
  likes: 120, comments: 7, offer: null, media_url: null, video_url: null, ...over,
});
const comp = (name: string, over: any = {}) => ({
  name,
  posts: { count: 0, total_engagement: 0, top: [] }, stories: { count: 0, with_offer: 0 },
  ads: { new_count: 0, active_count: 0, new: [], active: [] }, offers: { count: 0, items: [] },
  followers_delta: null, ...over,
});

const dailyActive = {
  report_type: 'daily', status: 'ready',
  period_start: new Date('2026-11-07T22:00:00Z'), period_end: new Date('2026-11-08T22:00:00Z'),
  created_date: new Date('2026-11-08T22:05:00Z'),
  data: {
    totals: { posts: 2, stories: 0, new_ads: 1, active_ads: 0, offers: 0, changes: 0 },
    competitors: [
      comp('https://www.ediamonds.co.il/', {
        posts: { count: 2, total_engagement: 400, top: [post({ likes: 300, comments: 100, media_url: S3_IMG, video_url: S3_VID })] },
        ads: { new_count: 1, active_count: 0, new: [{ platform: 'facebook', title: 'x', body: 'מבצע <b>סוף עונה</b>', cta: 'SHOP_NOW', link: 'http://fb.me/abc', started_at: '2026-11-08T07:00:00Z', offer: { details: '30% הנחה' }, media_url: null, video_url: null }], active: [] },
      }),
      comp('נפרד בע״מ'),
    ],
    changes: [],
    limits: ['סטוריז נאספים מאינסטגרם בלבד'],
  },
  summary: { headline: 'ediamonds העלתה שני פוסטים. <script>alert(1)</script>', highlights: ['קמפיין חדש'], recommended_actions: ['פעלו א', 'פעלו ב'], per_competitor: [{ name: 'ediamonds', summary: 'פוסטים' }] },
};

const emptyDaily = {
  report_type: 'daily', status: 'empty',
  period_start: new Date('2026-11-07T22:00:00Z'), period_end: new Date('2026-11-08T22:00:00Z'),
  created_date: new Date('2026-11-08T22:05:00Z'),
  data: { totals: { posts: 0, stories: 0, new_ads: 0, active_ads: 0, offers: 0, changes: 0 }, competitors: [comp('מתחרה א'), comp('מתחרה ב')], changes: [], limits: [] },
  summary: null,
};

const weekly = {
  report_type: 'weekly', status: 'ready',
  period_start: new Date('2026-10-31T22:00:00Z'), period_end: new Date('2026-11-07T22:00:00Z'),
  created_date: new Date('2026-11-07T22:05:00Z'),
  data: {
    totals: { posts: 5, stories: 3, new_ads: 0, active_ads: 2, offers: 1, changes: 1, reviews: 66 },
    competitors: [
      comp('קפה א', {
        posts: { count: 5, total_engagement: 500, top: [post()] }, stories: { count: 3, with_offer: 0 },
        ads: { new_count: 0, active_count: 2, new: [], active: [{ platform: 'instagram', body: 'עסקית 49 ש״ח', started_at: '2026-10-02T07:00:00Z', media_url: null, video_url: null }] },
        offers: { count: 1, items: [{ source: 'post', at: '2026-11-02T08:00:00Z', details: '1+1 על קפה', urgency: 'עד הערב' }] },
        reviews: { count: 4, avg_rating: 3.2, themes: [{ theme: 'service', total: 3, positive: 1, negative: 2 }], negative_samples: ['שירות   איטי\n\nמאוד'] },
        followers_delta: 12, current_rating: 4.6, current_review_count: 3903,
      }),
      comp('קפה ב'),
    ],
    own_reviews: { count: 7, avg_rating: 4.29, negative: 1, reply_rate: 0, themes: [{ theme: 'price', total: 2, positive: 2, negative: 0 }] },
    changes: [{ summary: 'שינוי מחיר' }],
    limits: ['לא נאספים נתוני סטוריז של פייסבוק', 'עוד מגבלה'],
  },
  summary: {
    headline: 'שבוע שקט', highlights: ['א', 'ב'], reviews_summary: 'סיכום ביקורות', recommended_actions: ['פעולה'],
    per_competitor: [{ name: 'קפה א', summary: 'פרסמה' }],
  },
};

const monthly = {
  ...weekly, report_type: 'monthly',
  period_start: new Date('2026-09-30T21:00:00Z'), period_end: new Date('2026-10-31T22:00:00Z'),
  data: {
    ...weekly.data,
    own: { posts: { count: 0, total_engagement: 0, top: [post({ caption: 'הפוסט שלנו' })] }, leads: { created: 4, won: 0 }, conversations: 9, auto_actions: { completed: 3 }, ads: { new_count: 0 }, followers_delta: -5 },
  },
  summary: { ...weekly.summary, own_summary: 'סיכום הפעילות שלנו' },
};

const html = (row: any, extra: any = {}) => buildReportHtml(row, { businessName: 'עסק לדוגמה', ...extra });
const has = (h: string, ...needles: string[]) => needles.forEach(n => expect(h).toContain(n));
const hasNot = (h: string, ...needles: string[]) => needles.forEach(n => expect(h).not.toContain(n));

describe('buildReportHtml — daily with activity', () => {
  const h = html(dailyActive);

  it('has the masthead, lead box, actions, table, cards and footer in order', () => {
    has(h, 'דוח מתחרים יומי', 'עסק לדוגמה', 'יום ראשון, 8 בנובמבר 2026', '2 מתחרים במעקב', 'בשורה אחת', 'עיקרי התקופה', 'מה כדאי לעשות',
      'המתחרים במספרים', 'הפוסטים הבולטים של המתחרים', 'מודעות חדשות', 'על הנתונים:', 'הופק 09.11.2026'); // 22:05Z is already the 9th in Israel
    const order = ['class="mast"', 'class="lead"', 'עיקרי התקופה', 'מה כדאי לעשות', 'המתחרים במספרים', 'הפוסטים הבולטים', '<h2>מודעות חדשות', 'class="foot"'].map(x => h.indexOf(x));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every(i => i >= 0)).toBe(true);
  });

  it('skips the weekly/monthly-only sections', () => {
    hasNot(h, 'לפי מתחרה', 'ביקורות<', 'הפעילות שלכם', 'אתם מול המתחרים', 'מודעות שעדיין רצות');
  });

  it('shows non-zero KPIs big and the zero ones on one grey line', () => {
    has(h, '<div class="kpi"><b>2</b><span>פוסטים</span></div>', '<div class="kpi"><b>1</b><span>מודעות חדשות</span></div>',
      'ללא פעילות ביום הזה: סטוריז · מודעות פעילות · מבצעים · שינויים שזוהו');
    hasNot(h, '<span>סטוריז</span></div>');
  });

  it('leaves out competitors with no activity and lists them under the table', () => {
    has(h, 'ללא פעילות ביום הזה: נפרד בע״מ');
  });

  it('cleans URL names and wraps names in <bdi>', () => {
    has(h, '<bdi>ediamonds.co.il</bdi>');
    hasNot(h, 'https://www.ediamonds', 'www.ediamonds');
  });

  it('escapes captions, headlines and names', () => {
    hasNot(h, '<script>', '<b>סוף עונה</b>');
    has(h, '&lt;script&gt;', '&lt;b&gt;סוף עונה&lt;/b&gt;');
  });

  it('skips fb.me links, keeps real ones, and reports hidden/likes text', () => {
    hasNot(h, 'fb.me');
    has(h, '<a href="https://www.instagram.com/p/AAA/">למקור ↗</a>', '300 לייקים', '100 תגובות', 'עלתה 08.11', 'כפתור: SHOP_NOW', '30% הנחה');
  });

  it('never mentions TikTok', () => {
    expect(h.toLowerCase()).not.toContain('tiktok');
    expect(html(monthly).toLowerCase()).not.toContain('tiktok');
  });
});

describe('buildReportHtml — images', () => {
  it('renders text-only cards when no image was inlined', () => {
    const h = html(dailyActive);
    has(h, 'card noimg');
    hasNot(h, '<img src="data:image', 'class="pic"');
  });

  it('shows the inlined image with a video tag and links stored videos through the proxy', () => {
    const h = html(dailyActive, { images: { [S3_IMG]: 'data:image/jpeg;base64,AAAA' }, videoHref: (u: string) => `https://app.test/api/competitors/proxy-image?url=${encodeURIComponent(u)}` });
    has(h, '<img src="data:image/jpeg;base64,AAAA"', '<span class="tag">וידאו</span>', 'צפייה בוידאו ↗', encodeURIComponent(S3_VID));
  });

  it('collects only the media URLs of cards that are shown', () => {
    expect(reportMediaUrls(dailyActive)).toEqual([S3_IMG]);
    expect(reportMediaUrls(emptyDaily)).toEqual([]);
  });

  it('videoHref links only our S3 objects', () => {
    const env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.test/';
    expect(videoHref('https://scontent.fbcdn.net/v.mp4')).toBeNull();
    expect(videoHref('https://example.com/x.mp4')).toBeNull();
    process.env.FRONTEND_URL = env;
  });
});

describe('buildReportHtml — empty daily', () => {
  it('says there was no activity and lists the tracked competitors as chips', () => {
    const h = html(emptyDaily);
    has(h, 'לא זוהתה פעילות חדשה של המתחרים ביום הזה.', 'המתחרים במעקב', '<span class="chip"><bdi>מתחרה א</bdi></span>',
      'ללא פעילות ביום הזה: פוסטים · סטוריז');
    hasNot(h, 'עיקרי התקופה', 'מה כדאי לעשות', 'ממשיכות לרוץ', '<table>');
  });

  it('with only running ads shows the count, the table and the running-ad cards', () => {
    const row = { ...emptyDaily, data: { ...emptyDaily.data, totals: { ...emptyDaily.data.totals, active_ads: 3 },
      competitors: [comp('מתחרה א', { ads: { new_count: 0, active_count: 3, new: [], active: [{ platform: 'instagram', body: 'עסקית רצה', started_at: '2026-10-02T07:00:00Z' }] } })] } };
    const h = html(row);
    has(h, 'לא זוהתה פעילות חדשה של המתחרים ביום הזה — 3 מודעות שלהם ממשיכות לרוץ.', '<table>', 'מודעות שעדיין רצות', 'רצה מאז 02.10', 'עסקית רצה');
    hasNot(h, 'המתחרים במעקב</h2>');
  });

  it('treats a missing headline like an empty report', () => {
    has(html({ ...dailyActive, summary: {} }), 'לא זוהתה פעילות חדשה');
  });
});

describe('buildReportHtml — weekly', () => {
  const h = html(weekly);

  it('has the period label and weekly sections', () => {
    has(h, 'דוח מתחרים שבועי', '1–7 בנובמבר 2026', 'אתם מול המתחרים', 'ביקורות', 'סיכום ביקורות', 'לפי מתחרה', 'שינויים שזוהו', 'מודעות שעדיין רצות',
      'מבצעים שזוהו', 'עד הערב', 'על הנתונים:', 'לא נאספים נתוני סטוריז של פייסבוק · עוד מגבלה');
    hasNot(h, 'הפעילות שלכם</h2>', 'הפוסטים הבולטים שלכם');
  });

  it('counts competitor reviews only in the KPI strip', () => {
    has(h, '<div class="kpi"><b>4</b><span>ביקורות על מתחרים</span></div>');
    hasNot(h, '<b>66</b>');
    expect(reportKpis(weekly.data).on).toContainEqual(['ביקורות על מתחרים', 4]);
  });

  it('puts "you" first in the table, grey dashes for uncollected values, red/green review stats', () => {
    has(h, '<tr class="you"><td class="name"><b>אתם</b>', '<span class="na">—</span>', '<b class="bad">0%</b>', '★ 4.6 <span class="cnt">(3,903)</span>',
      '<span class="bad">3.20</span>', '<bdi class="good">+12</bdi>', 'ביקורת על <bdi>קפה א</bdi>', 'שירות איטי מאוד');
    expect(h.indexOf('<tr class="you">')).toBeLessThan(h.indexOf('<bdi>קפה א</bdi></td>'));
  });

  it('draws the bar on the first shown column and bolds the column max', () => {
    has(h, 'class="cellbar"', 'class="track"');
    expect(h.match(/class="cellbar"/g)).toHaveLength(1); // the active competitor; "you" has no engagement value (—)
  });
});

describe('buildReportHtml — monthly', () => {
  const h = html(monthly);

  it('adds our own activity and posts', () => {
    has(h, 'דוח מתחרים חודשי', 'אוקטובר 2026', 'הפעילות שלכם', 'סיכום הפעילות שלנו', 'לידים חדשים', 'לידים שנסגרו', 'שיחות', 'פעולות אוטומטיות',
      'הפוסטים הבולטים שלכם', 'הפוסט שלנו', '<bdi class="bad">-5</bdi>');
  });
});

describe('helpers', () => {
  it('cleans competitor names and bare URLs in text', () => {
    expect(cleanName('https://www.ediamonds.co.il/')).toBe('ediamonds.co.il');
    expect(cleanName('גקסון תכשיטים')).toBe('גקסון תכשיטים');
    expect(cleanName('')).toBe('—');
    expect(tx('ל https://ediamonds.co.il/ יש')).toBe('ל ediamonds.co.il יש');
  });

  it('formats Hebrew period labels in Israel time (end exclusive)', () => {
    expect(hebrewPeriodLabel('weekly', '2026-10-31T22:00:00Z', '2026-11-07T22:00:00Z')).toBe('1–7 בנובמבר 2026');
    expect(hebrewPeriodLabel('weekly', '2026-10-24T21:00:00Z', '2026-10-31T22:00:00Z')).toBe('25–31 באוקטובר 2026'); // across the DST switch
    expect(hebrewPeriodLabel('weekly', '2026-11-28T22:00:00Z', '2026-12-05T22:00:00Z')).toBe('29 בנובמבר – 5 בדצמבר 2026');
    expect(hebrewPeriodLabel('daily', '2026-11-06T22:00:00Z', '2026-11-07T22:00:00Z')).toBe('יום שבת, 7 בנובמבר 2026');
    expect(hebrewPeriodLabel('monthly', '2026-09-30T21:00:00Z', '2026-10-31T22:00:00Z')).toBe('אוקטובר 2026');
  });

  it('names the attachment with ASCII only', () => {
    expect(reportPdfFilename(weekly)).toBe('cortexi-weekly-2026-11-01.pdf');
  });
});

const CHROME = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && fs.existsSync(p));
(CHROME ? describe : describe.skip)('renderReportPdf (real Chromium)', () => {
  it('prints a PDF', async () => {
    const prev = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = CHROME;
    try {
      const pdf = await renderReportPdf(monthly as any, 'עסק לדוגמה');
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(10_000);
    } finally { process.env.CHROMIUM_PATH = prev; }
  }, 90_000);
});
