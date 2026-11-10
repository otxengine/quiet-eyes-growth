/**
 * Competitor reports (generateReport.ts) for the customer:
 *   GET      /api/reports?businessProfileId=&type=&limit=   list, newest period first (no report body)
 *   GET      /api/reports/:id                                one report with its data and narrative
 *   GET      /api/reports/:id/pdf                            the stored PDF
 *   GET|POST /api/reports/unsubscribe?b=&r=&t=               public: the link in every customer email
 *   GET      /api/reports/:id/view?e=&t=                     public: the web report, from the email's signed link
 *   GET      /api/reports/:id/view/pdf?e=&t=                 public: its PDF, same signed link
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireOwnsBusinessFields, requireOwnsRecord } from '../middleware/businessAccess';
import { REPORT_TYPES, ReportType } from '../lib/reportPeriod';
import { downloadReportPdf, isS3Url } from '../lib/s3';
import { reportLinkValid, unsubscribe } from '../lib/reportDelivery';
import { businessLocale } from '../lib/businessLocale';
import { reportPdfFilename } from '../lib/reportPdf';
import { buildReportHtml } from '../lib/reportPdf/html';
import { buildReportLists } from '../lib/reportData';

const router = Router();

const notice = (text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Cortexi</title></head>`
  + `<body style="font-family:Arial,sans-serif;text-align:center;padding:64px 16px;color:#101014"><p style="font-size:18px">${text}</p></body></html>`;

// Our stored (S3) images and videos through the public media proxy, same origin as the page.
// Raw social CDN links expire within days, so those cards stay text-only.
const proxied = (url: string) => (isS3Url(url) ? `/api/competitors/proxy-image?url=${encodeURIComponent(url)}` : null);

const signedLink = (req: Request) => {
  const [e, t] = ['e', 't'].map(k => (typeof req.query[k] === 'string' ? (req.query[k] as string) : ''));
  const id = String(req.params.id);
  return reportLinkValid(id, e, t) ? { id, e, t } : null;
};

const WEB_HEADERS: Record<string, string> = {
  // The page carries scraped and LLM text: no scripts at all, images only through our own proxy.
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer', // the URL carries the link token
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'private, no-store',
};

async function sendPdf(report: { linked_business: string; pdf_url: string | null } & Parameters<typeof reportPdfFilename>[0], res: Response) {
  const pdf = report.pdf_url ? await downloadReportPdf(report.pdf_url, report.linked_business) : null;
  if (!pdf) return res.status(404).json({ error: 'Not found' });
  const { tz } = await businessLocale(report.linked_business);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${reportPdfFilename(report, tz)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(pdf);
}

// Registered before '/:id' so "unsubscribe" is never read as a report id. Public (apiAuth.ts): it is
// opened from an email, signed per recipient. POST is the mail client's one-click (RFC 8058) form.
router.all('/unsubscribe', async (req: Request, res: Response) => {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const [b, r, t] = ['b', 'r', 't'].map(k => (typeof req.query[k] === 'string' ? (req.query[k] as string) : ''));
  let ok = false;
  try { ok = await unsubscribe(b, r, t); } catch (e: any) { console.error('[reports] unsubscribe failed:', e.message); }
  const en = ok && (await businessLocale(b)).lang === 'en';
  const text = !ok ? 'This unsubscribe link is not valid.'
    : en ? 'You have been unsubscribed from Cortexi competitor reports.' : 'הוסרת מרשימת התפוצה של דוחות המתחרים של Cortexi.';
  res.status(ok ? 200 : 400).type('html').send(
    `<!doctype html><html lang="${en || !ok ? 'en' : 'he'}" dir="${en || !ok ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Cortexi</title></head>`
    + `<body style="font-family:Arial,sans-serif;text-align:center;padding:64px 16px;color:#101014"><p style="font-size:18px">${text}</p></body></html>`);
});

router.get('/', requireOwnsBusinessFields, async (req: Request, res: Response) => {
  const businessProfileId = req.query.businessProfileId;
  if (typeof businessProfileId !== 'string' || !businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  const type = req.query.type;
  if (type !== undefined && !REPORT_TYPES.includes(type as ReportType)) {
    return res.status(400).json({ error: `type must be one of: ${REPORT_TYPES.join(', ')}` });
  }
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 30));
  try {
    const rows = await prisma.report.findMany({
      where: { linked_business: businessProfileId, ...(type ? { report_type: type as string } : {}) },
      orderBy: { period_start: 'desc' },
      take: limit,
      select: { id: true, report_type: true, period_start: true, period_end: true, status: true, summary: true, pdf_url: true, created_date: true },
    });
    return res.json({
      reports: rows.map(({ summary, pdf_url, ...r }) => ({ ...r, headline: (summary as any)?.headline ?? null, has_pdf: !!pdf_url })),
    });
  } catch (err: any) {
    console.error('[reports] list failed:', err.message);
    return res.status(500).json({ error: 'Failed to load reports' });
  }
});

const ownsReport = requireOwnsRecord(async id =>
  (await prisma.report.findUnique({ where: { id }, select: { linked_business: true } }))?.linked_business);

router.get('/:id', ownsReport, async (req: Request, res: Response) => {
  const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
  if (!report) return res.status(404).json({ error: 'Not found' });
  const { pdf_url, cost_usd, ...rest } = report; // our cost and the raw bucket URL are not the customer's
  return res.json({ report: { ...rest, has_pdf: !!pdf_url } });
});

router.get('/:id/pdf', ownsReport, async (req: Request, res: Response) => {
  const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
  if (!report) return res.status(404).json({ error: 'Not found' });
  return sendPdf(report, res);
});

// The web report: the PDF's summary, then "Show all" for every post, ad, offer and review of the
// period (buildReportLists, read fresh on each view). Public — the signed link is the access.
router.get('/:id/view', async (req: Request, res: Response) => {
  const link = signedLink(req);
  if (!link) return res.status(403).type('html').send(notice('This link has expired or is not valid. · הקישור פג תוקף או אינו תקין.'));
  try {
    const report = await prisma.report.findUnique({ where: { id: link.id } });
    if (!report) return res.status(404).type('html').send(notice('This report no longer exists.'));
    const bp = await prisma.businessProfile.findUnique({ where: { id: report.linked_business }, select: { name: true } });
    const locale = await businessLocale(report.linked_business);
    const lists = await buildReportLists(report.linked_business, report.report_type as ReportType, report.period_start, report.period_end);
    const html = buildReportHtml(report, {
      businessName: bp?.name ?? '', locale, videoHref: proxied,
      web: {
        lists, imageSrc: proxied,
        pdfHref: report.pdf_url ? `/api/reports/${encodeURIComponent(link.id)}/view/pdf?e=${link.e}&t=${encodeURIComponent(link.t)}` : null,
      },
    });
    for (const [k, v] of Object.entries(WEB_HEADERS)) res.setHeader(k, v);
    return res.type('html').send(html);
  } catch (err: any) {
    console.error('[reports] web report failed:', err.message);
    return res.status(500).type('html').send(notice('The report could not be loaded. Please try again in a minute.'));
  }
});

router.get('/:id/view/pdf', async (req: Request, res: Response) => {
  const link = signedLink(req);
  if (!link) return res.status(403).type('html').send(notice('This link has expired or is not valid. · הקישור פג תוקף או אינו תקין.'));
  const report = await prisma.report.findUnique({ where: { id: link.id } });
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Referrer-Policy', 'no-referrer');
  return sendPdf(report, res);
});

export default router;
