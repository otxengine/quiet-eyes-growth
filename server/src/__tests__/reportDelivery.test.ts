// Customer delivery of the competitor report: recipients, the signed unsubscribe link, the customer
// email (footer + List-Unsubscribe), the reports routes and the region filter of the scheduler.
const queryRaw = jest.fn();
const executeRaw = jest.fn(async () => 1);
const reportFindMany = jest.fn();
const reportFindUnique = jest.fn();
jest.mock('../db', () => ({
  prisma: {
    $queryRaw: (...a: any[]) => queryRaw(...a),
    $executeRaw: (...a: any[]) => (executeRaw as any)(...a),
    report: { findMany: (...a: any[]) => reportFindMany(...a), findUnique: (...a: any[]) => reportFindUnique(...a) },
  },
}));
const sendEmail = jest.fn(async () => true);
jest.mock('../lib/email', () => ({ sendEmail: (...a: any[]) => (sendEmail as any)(...a) }));
jest.mock('../middleware/auth', () => ({ getUserId: () => 'u1' }));
jest.mock('../lib/s3', () => ({ downloadReportPdf: jest.fn(async () => null), isS3Url: () => false }));
jest.mock('../lib/reportPdf', () => ({ reportPdfFilename: () => 'cortexi-weekly-2026-11-01.pdf' }));

import { parseRecipients, customerRecipients, unsubscribeUrl, unsubscribe } from '../lib/reportDelivery';
import { sendReportEmail } from '../lib/reportEmail';
import reportsRouter from '../routes/reports';

const OLD_ENV = process.env;
const weekly = {
  report_type: 'weekly', period_start: new Date('2026-11-01T04:00:00Z'), period_end: new Date('2026-11-08T05:00:00Z'),
  data: { totals: { posts: 3 }, competitors: [] }, summary: { headline: 'Rival Pizza posted 3 times' },
};
const NY = { lang: 'en' as const, intl: 'en-US', tz: 'America/New_York' };
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
const handler = (path: string, method: string) => {
  const layer = (reportsRouter as any).stack.find((l: any) => l.route?.path === path && (l.route.methods[method] || l.route.methods._all));
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
const res = () => {
  const r: any = { statusCode: 200, body: undefined as any };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.type = () => r; r.send = (b: any) => { r.body = b; return r; }; r.end = () => r; r.setHeader = () => r;
  return r;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, REPORT_UNSUBSCRIBE_SECRET: 's3cret', FRONTEND_URL: 'https://app.example.com/', REPORT_EMAIL_RECIPIENTS: '' };
  queryRaw.mockResolvedValue([{ report_recipients: 'Owner@Example.com, partner@example.com , not-an-email' }]);
});
afterAll(() => { process.env = OLD_ENV; });

describe('recipients', () => {
  it('parses, lower-cases, de-duplicates and drops non-addresses', () => {
    expect(parseRecipients('A@x.com, a@x.com ,b@y.io,nope,,')).toEqual(['a@x.com', 'b@y.io']);
    expect(parseRecipients(null)).toEqual([]);
  });
  it('reads them from the business; a failed lookup means nobody', async () => {
    expect(await customerRecipients('bp1')).toEqual(['owner@example.com', 'partner@example.com']);
    queryRaw.mockRejectedValueOnce(new Error('column does not exist'));
    expect(await customerRecipients('bp1')).toEqual([]);
  });
});

describe('unsubscribe link', () => {
  it('carries no email address and removes exactly that recipient', async () => {
    const url = unsubscribeUrl('bp1', 'owner@example.com')!;
    expect(url).toMatch(/^https:\/\/app\.example\.com\/api\/reports\/unsubscribe\?b=bp1&r=[0-9a-f]{16}&t=/);
    expect(url).not.toContain('owner');
    const { b, r, t } = params(url);
    expect(await unsubscribe(b, r, t)).toBe(true);
    expect((executeRaw.mock.calls[0] as any[])[1]).toBe('partner@example.com'); // what is left
  });
  it('the last recipient leaving turns delivery off (NULL)', async () => {
    queryRaw.mockResolvedValue([{ report_recipients: 'owner@example.com' }]);
    const { b, r, t } = params(unsubscribeUrl('bp1', 'owner@example.com')!);
    await unsubscribe(b, r, t);
    expect((executeRaw.mock.calls[0] as any[])[1]).toBeNull();
  });
  it('refuses a forged token, another business, or a missing secret', async () => {
    const { b, r, t } = params(unsubscribeUrl('bp1', 'owner@example.com')!);
    expect(await unsubscribe(b, r, t.slice(0, -2) + 'xx')).toBe(false);
    expect(await unsubscribe('bp2', r, t)).toBe(false);
    process.env.REPORT_UNSUBSCRIBE_SECRET = '';
    expect(await unsubscribe(b, r, t)).toBe(false);
    expect(unsubscribeUrl('bp1', 'owner@example.com')).toBeNull();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('customer report email', () => {
  it('sends one email per recipient with its own unsubscribe link, header and postal address', async () => {
    process.env.COMPANY_POSTAL_ADDRESS = '1 Example St, Tel Aviv';
    expect(await sendReportEmail(weekly as any, "Joe's Pizza", null, NY, 'bp1')).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const [first, second] = sendEmail.mock.calls.map(c => (c as any[])[0]);
    expect(first.to).toBe('owner@example.com');
    expect(second.to).toBe('partner@example.com');
    const link = first.headers['List-Unsubscribe'].slice(1, -1);
    expect(first.html).toContain(link.replace(/&/g, '&amp;'));
    expect(first.html).toContain('Unsubscribe');
    expect(first.html).toContain('1 Example St, Tel Aviv');
    expect(first.html).not.toContain('internal distribution list');
    expect(first.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(second.headers['List-Unsubscribe']).not.toBe(first.headers['List-Unsubscribe']);
  });
  it('customers get the "Open the full report" link instead of the attachment; the internal list keeps both', async () => {
    process.env.REPORT_EMAIL_RECIPIENTS = 'team@example.com';
    const pdf = { filename: 'cortexi-weekly-2026-11-01.pdf', content: Buffer.from('%PDF') };
    await sendReportEmail({ ...weekly, id: 'r1' } as any, "Joe's Pizza", pdf, NY, 'bp1');
    const [internal, customer] = sendEmail.mock.calls.map(c => (c as any[])[0]);
    for (const m of [internal, customer]) {
      expect(m.html).toContain('https://app.example.com/api/reports/r1/view?e=');
      expect(m.html).toContain('Open the full report');
    }
    expect(internal.attachments).toHaveLength(1);
    expect(customer.attachments).toBeUndefined();
    expect(customer.html).not.toContain('attached');
  });
  it('without a report id (no web link) the customer still gets the PDF attached', async () => {
    const pdf = { filename: 'cortexi-weekly-2026-11-01.pdf', content: Buffer.from('%PDF') };
    await sendReportEmail(weekly as any, "Joe's Pizza", pdf, NY, 'bp1');
    const customer = (sendEmail.mock.calls[0] as any[])[0];
    expect(customer.attachments).toHaveLength(1);
    expect(customer.html).not.toContain('Open the full report');
  });
  it('never emails a customer without an unsubscribe link', async () => {
    process.env.REPORT_UNSUBSCRIBE_SECRET = '';
    expect(await sendReportEmail(weekly as any, "Joe's Pizza", null, NY, 'bp1')).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('without a business id only the internal list is used, as before', async () => {
    process.env.REPORT_EMAIL_RECIPIENTS = 'team@example.com';
    await sendReportEmail(weekly as any, "Joe's Pizza", null, NY);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as any[])[0].to).toEqual(['team@example.com']);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('reports routes', () => {
  it('unsubscribe: a valid link answers 200, anything else 400', async () => {
    const q = params(unsubscribeUrl('bp1', 'owner@example.com')!);
    const ok = res();
    await handler('/unsubscribe', 'get')({ method: 'GET', query: q } as any, ok);
    expect(ok.statusCode).toBe(200);
    const bad = res();
    await handler('/unsubscribe', 'get')({ method: 'GET', query: { ...q, t: 'nope' } } as any, bad);
    expect(bad.statusCode).toBe(400);
  });
  it('list: newest first, headline and has_pdf only — no report body, cost or bucket URL', async () => {
    reportFindMany.mockResolvedValue([{ id: 'r1', report_type: 'weekly', period_start: weekly.period_start, period_end: weekly.period_end, status: 'ready', summary: weekly.summary, pdf_url: 'https://bucket/reports/bp1/weekly-2026-11-01.pdf', created_date: new Date() }]);
    const r = res();
    await handler('/', 'get')({ query: { businessProfileId: 'bp1', type: 'weekly', limit: '500' } } as any, r);
    expect(reportFindMany.mock.calls[0][0]).toMatchObject({ where: { linked_business: 'bp1', report_type: 'weekly' }, orderBy: { period_start: 'desc' }, take: 60 });
    expect(r.body.reports[0]).toMatchObject({ id: 'r1', headline: 'Rival Pizza posted 3 times', has_pdf: true });
    expect(r.body.reports[0].view_url).toMatch(/\/api\/reports\/r1\/view\?e=\d+&t=/); // the account page's "View report" link
    expect(JSON.stringify(r.body)).not.toContain('bucket');
    const badType = res();
    await handler('/', 'get')({ query: { businessProfileId: 'bp1', type: 'yearly' } } as any, badType);
    expect(badType.statusCode).toBe(400);
  });
  it('one report: returned without our cost or the bucket URL', async () => {
    reportFindUnique.mockResolvedValue({ id: 'r1', linked_business: 'bp1', data: {}, summary: {}, cost_usd: 0.03, pdf_url: 'https://bucket/x.pdf' });
    const r = res();
    await handler('/:id', 'get')({ params: { id: 'r1' } } as any, r);
    expect(r.body.report).toEqual({ id: 'r1', linked_business: 'bp1', data: {}, summary: {}, has_pdf: true });
  });
});
