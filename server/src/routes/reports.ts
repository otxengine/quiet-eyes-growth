/**
 * Competitor reports (generateReport.ts) for the customer:
 *   GET      /api/reports?businessProfileId=&type=&limit=   list, newest period first (no report body)
 *   GET      /api/reports/:id                                one report with its data and narrative
 *   GET      /api/reports/:id/pdf                            the stored PDF
 *   GET|POST /api/reports/unsubscribe?b=&r=&t=               public: the link in every customer email
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireOwnsBusinessFields, requireOwnsRecord } from '../middleware/businessAccess';
import { REPORT_TYPES, ReportType } from '../lib/reportPeriod';
import { downloadReportPdf } from '../lib/s3';
import { unsubscribe } from '../lib/reportDelivery';
import { businessLocale } from '../lib/businessLocale';
import { reportPdfFilename } from '../lib/reportPdf';

const router = Router();

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
  const pdf = report?.pdf_url ? await downloadReportPdf(report.pdf_url, report.linked_business) : null;
  if (!report || !pdf) return res.status(404).json({ error: 'Not found' });
  const { tz } = await businessLocale(report.linked_business);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${reportPdfFilename(report, tz)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(pdf);
});

export default router;
