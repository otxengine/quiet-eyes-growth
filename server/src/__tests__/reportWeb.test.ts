// The web report: the HTML builder's web mode ("Show all", proxied images, no story media), the
// round-robin ad cards, the signed per-report link, and the public /:id/view routes. Fixtures are synthetic.
const reportFindUnique = jest.fn();
const bpFindUnique = jest.fn(async () => ({ name: 'Northside Coffee' }));
jest.mock('../db', () => ({
  prisma: {
    $queryRaw: jest.fn(async () => [{ locale: 'en-US', timezone: 'America/Chicago' }]),
    report: { findUnique: (...a: any[]) => reportFindUnique(...a) },
    businessProfile: { findUnique: (...a: any[]) => (bpFindUnique as any)(...a) },
  },
}));
const buildReportLists = jest.fn();
jest.mock('../lib/reportData', () => ({ buildReportLists: (...a: any[]) => buildReportLists(...a) }));
const downloadReportPdf = jest.fn(async () => Buffer.from('%PDF-1.4'));
jest.mock('../lib/s3', () => ({
  isS3Url: (u: string) => u.startsWith('https://bucket.s3.'),
  downloadReportPdf: (...a: any[]) => (downloadReportPdf as any)(...a),
}));
jest.mock('../middleware/auth', () => ({ getUserId: () => null }));

import { buildReportHtml, roundRobin } from '../lib/reportPdf/html';
import { reportLinkValid, reportViewUrl, unsubscribeUrl, REPORT_LINK_DAYS } from '../lib/reportDelivery';
import reportsRouter from '../routes/reports';

const S3 = (n: number) => `https://bucket.s3.us-east-1.amazonaws.com/competitor-posts/${String(n).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg`;
const EN = { lang: 'en' as const, intl: 'en-US', tz: 'America/Chicago' };
const post = (i: number, over: any = {}) => ({
  platform: 'instagram', url: `https://www.instagram.com/p/P${i}/`, caption: `Post ${i}`, posted_at: `2026-10-${String(10 + i).padStart(2, '0')}T15:00:00Z`,
  likes: 100 + i, comments: i, offer: null, media_url: S3(i), video_url: null, ...over,
});
const ad = (i: number, over: any = {}) => ({
  platform: 'facebook', title: null, body: `Ad ${i}`, cta: 'Order now', link: `https://example.com/ad${i}`,
  started_at: `2026-10-${String(10 + i).padStart(2, '0')}T15:00:00Z`, offer: null, media_url: null, video_url: null, ...over,
});
const comp = (id: string, name: string, over: any = {}) => ({
  id, name, posts: { count: 0, total_engagement: 0, top: [] }, stories: { count: 0, with_offer: 0 },
  ads: { new_count: 0, active_count: 0, new: [], active: [] }, offers: { count: 0, items: [] }, followers_delta: null, ...over,
});

// Busy Brew (6 new ads) comes first by name; Quiet Cafe (1 ad) was cut off by "the first 6 in list order".
const monthly = {
  id: 'r1', report_type: 'monthly', status: 'ready',
  period_start: new Date('2026-10-01T05:00:00Z'), period_end: new Date('2026-11-01T05:00:00Z'),
  created_date: new Date('2026-11-01T13:00:00Z'), pdf_url: 'https://bucket.s3.us-east-1.amazonaws.com/reports/bp1/monthly-2026-10-01.pdf',
  linked_business: 'bp1',
  data: {
    totals: { posts: 5, stories: 4, new_ads: 7, active_ads: 7, offers: 2, changes: 0, reviews: 3 },
    competitors: [
      comp('c1', 'Busy Brew', {
        posts: { count: 4, total_engagement: 500, top: [post(1), post(2), post(3)] },
        ads: { new_count: 6, active_count: 6, new: [1, 2, 3, 4, 5].map(i => ad(i)), active: [] },
        offers: { count: 2, items: [
          { source: 'story', platform: 'instagram', at: '2026-10-20T15:00:00Z', details: 'BOGO Tuesdays', urgency: 'Tuesdays only' },
          { source: 'post', platform: 'instagram', url: 'https://www.instagram.com/p/P1/', at: '2026-10-11T15:00:00Z', details: '$1 off' },
        ] },
      }),
      comp('c2', 'Quiet Cafe', {
        posts: { count: 1, total_engagement: 50, top: [post(9, { likes: 40 })] },
        ads: { new_count: 1, active_count: 1, new: [ad(9, { body: 'Quiet ad' })], active: [] },
      }),
    ],
    changes: [], limits: [],
  },
  summary: { headline: 'Busy Brew ran 6 new ads', highlights: ['a'], reviews_summary: 'ok', own_summary: 'ok', recommended_actions: ['x'], per_competitor: [] },
};
const lists = {
  c1: {
    posts: [4, 3, 2, 1].map(i => post(i, { caption: i === 4 ? '<img src=x onerror=alert(1)>' : `Post ${i}` })),
    new_ads: [6, 5, 4, 3, 2, 1].map(i => ad(i)),
    running_ads: [],
    offers: monthly.data.competitors[0].offers.items,
    reviews: [{ rating: 2, text: 'Slow service', at: '2026-10-05T15:00:00Z' }, { rating: 5, text: 'Great', at: '2026-10-04T15:00:00Z' }],
  },
  c2: { posts: [post(9)], new_ads: [ad(9, { body: 'Quiet ad' })], running_ads: [], offers: [], reviews: [{ rating: 4, text: 'Nice', at: '2026-10-03T15:00:00Z' }] },
};
const proxied = (u: string) => (u.startsWith('https://bucket.s3.') ? `/api/competitors/proxy-image?url=${encodeURIComponent(u)}` : null);
const web = (row: any = monthly) =>
  buildReportHtml(row, { businessName: 'Northside Coffee', locale: EN, web: { lists, imageSrc: proxied, pdfHref: '/api/reports/r1/view/pdf?e=1&t=x' } });
const between = (h: string, from: string, to: string) => h.split(from)[1].split(to)[0];

describe('roundRobin', () => {
  it('takes each competitor in turn, busiest first, up to n', () => {
    expect(roundRobin([['A', [1, 2, 3, 4, 5]], ['B', [9]], ['C', []]], 4)).toEqual([['A', 1], ['B', 9], ['A', 2], ['A', 3]]);
  });
});

describe('buildReportHtml — web page', () => {
  it('is a responsive, unindexed page with the PDF button', () => {
    const h = web();
    expect(h).toContain('name="viewport"');
    expect(h).toContain('name="robots" content="noindex"');
    expect(h).toContain('<main class="page">');
    expect(h).toContain('href="/api/reports/r1/view/pdf?e=1&amp;t=x">Download PDF</a>');
  });

  it('ad cards reach every competitor, not just the first one in the list', () => {
    expect(between(web(), '<h2>New ads', '<details')).toContain('Quiet ad');
  });

  it('"Show all" lists every item of the period, grouped by competitor, busiest first, first group open', () => {
    const h = web();
    expect(h).toContain('Show all 5 posts <span class="from">from 2 competitors</span>');
    expect(h).toContain('Show all 7 new ads');
    const posts = between(h, 'Show all 5 posts', '</section>');
    expect(posts.indexOf('Busy Brew')).toBeLessThan(posts.indexOf('Quiet Cafe'));
    expect(posts).toMatch(/<details class="grp" open><summary><bdi>Busy Brew/);
    expect(h).toContain('Show all 3 competitor reviews');
    expect(h).toContain('aria-label="2 of 5 stars"');
  });

  it('escapes list text and loads images only through the proxy, lazily', () => {
    const h = web();
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain(`src="/api/competitors/proxy-image?url=${encodeURIComponent(S3(4))}" alt="" loading="lazy"`);
    expect(h).not.toContain('src="https://bucket.s3.');
  });

  it('a story offer has no link and no image — stories are analysed, never shown', () => {
    const offers = between(web(), '<h2>Offers detected', '</section>');
    const storyCard = between(offers, 'In a story', '</div></div>');
    expect(storyCard).not.toContain('href=');
    expect(storyCard).not.toContain('<img');
  });

  it('no "Show all" when the cards already show everything', () => {
    expect(web()).not.toContain('Show all 2 offers'); // both stored offers are already listed
  });

  it('the PDF is unchanged: no lists, no page chrome', () => {
    const h = buildReportHtml(monthly, { businessName: 'Northside Coffee', locale: EN });
    for (const s of ['<details', 'name="viewport"', '<main class="page">', 'Download PDF', 'proxy-image']) expect(h).not.toContain(s);
  });
});

describe('signed report link', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV, REPORT_UNSUBSCRIBE_SECRET: 's3cret', FRONTEND_URL: 'https://app.example.com/' }; });
  afterAll(() => { process.env = OLD_ENV; });
  const parts = (url: string) => { const u = new URL(url); return { id: u.pathname.split('/')[3], e: u.searchParams.get('e')!, t: u.searchParams.get('t')! }; };

  it('opens exactly the report it was issued for, until it expires', () => {
    const now = Date.UTC(2026, 10, 1);
    const { id, e, t } = parts(reportViewUrl('r1', now)!);
    expect(id).toBe('r1');
    expect(reportLinkValid('r1', e, t, now)).toBe(true);
    expect(reportLinkValid('r2', e, t, now)).toBe(false); // another report's id with this token
    expect(reportLinkValid('r1', String(Number(e) + 86400), t, now)).toBe(false); // a later expiry
    expect(reportLinkValid('r1', e, `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, now)).toBe(false);
    expect(reportLinkValid('r1', e, t, now + (REPORT_LINK_DAYS + 1) * 86400000)).toBe(false);
  });

  it('an unsubscribe token is not a report token, and nothing works without the secret', () => {
    const unsub = new URL(unsubscribeUrl('r1', 'a@b.co')!).searchParams;
    const e = String(Math.floor(Date.now() / 1000) + 3600);
    expect(reportLinkValid('r1', e, unsub.get('t')!)).toBe(false);
    const { t } = parts(reportViewUrl('r1')!);
    process.env.REPORT_UNSUBSCRIBE_SECRET = '';
    expect(reportViewUrl('r1')).toBeNull();
    expect(reportLinkValid('r1', e, t)).toBe(false);
  });
});

describe('/:id/view routes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, REPORT_UNSUBSCRIBE_SECRET: 's3cret', FRONTEND_URL: 'https://app.example.com' };
    reportFindUnique.mockResolvedValue(monthly);
    buildReportLists.mockResolvedValue(lists);
  });
  afterAll(() => { process.env = OLD_ENV; });
  const handler = (path: string) => {
    const layer = (reportsRouter as any).stack.find((l: any) => l.route?.path === path);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const res = () => {
    const r: any = { statusCode: 200, headers: {} as Record<string, string> };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.type = () => r; r.json = (b: any) => { r.body = b; return r; }; r.send = (b: any) => { r.body = b; return r; }; r.end = () => r;
    r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
    return r;
  };
  const query = (id: string) => { const u = new URL(reportViewUrl(id)!); return { e: u.searchParams.get('e'), t: u.searchParams.get('t') }; };

  it('a valid link renders the report with locked-down headers and the period lists', async () => {
    const r = res();
    await handler('/:id/view')({ params: { id: 'r1' }, query: query('r1') } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Northside Coffee');
    expect(r.body).toContain('Show all 5 posts');
    expect(r.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(r.headers['Referrer-Policy']).toBe('no-referrer');
    expect(buildReportLists).toHaveBeenCalledWith('bp1', 'monthly', monthly.period_start, monthly.period_end);
  });

  it('a link for another report, or a forged one, gets 403 and never reads the database', async () => {
    for (const q of [query('r2'), { ...query('r1'), t: 'forged' }, {}]) {
      const r = res();
      await handler('/:id/view')({ params: { id: 'r1' }, query: q } as any, r);
      expect(r.statusCode).toBe(403);
    }
    expect(reportFindUnique).not.toHaveBeenCalled();
  });

  it("the PDF button uses the same link, and the PDF must belong to the report's business", async () => {
    const r = res();
    await handler('/:id/view/pdf')({ params: { id: 'r1' }, query: query('r1') } as any, r);
    expect(r.headers['Content-Type']).toBe('application/pdf');
    expect(downloadReportPdf).toHaveBeenCalledWith(monthly.pdf_url, 'bp1');
    const bad = res();
    await handler('/:id/view/pdf')({ params: { id: 'r1' }, query: query('r2') } as any, bad);
    expect(bad.statusCode).toBe(403);
  });
});
