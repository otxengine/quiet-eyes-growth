/**
 * Server-side PDF of a competitor report: row -> HTML (html.ts) -> headless Chromium print.
 * The page is rendered with JavaScript off and every network request blocked; post/ad images
 * are fetched here from our own S3 copies and inlined, never by the browser.
 */
import puppeteer from 'puppeteer-core';
import { downloadFromS3, isS3Url, safeMediaType, uploadObjectToS3 } from '../s3';
import { buildReportHtml, reportMediaUrls, ReportRow } from './html';
import type { BizLocale } from '../locale';

export { buildReportHtml, reportMediaUrls } from './html';
export type { ReportRow } from './html';

const RENDER_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 24;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Original URL -> data: URI for each URL that is one of our S3 objects, an image and not huge.
 * Everything else is left out, so its card renders text-only.
 */
export async function inlineImages(urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(urls.filter(isS3Url).slice(0, MAX_IMAGES).map(async url => {
    try {
      const obj = await downloadFromS3(url);
      const type = obj && safeMediaType(obj.contentType);
      if (!obj || !type || !IMAGE_TYPES.has(type) || obj.body.length > MAX_IMAGE_BYTES) return;
      out[url] = `data:${type};base64,${obj.body.toString('base64')}`;
    } catch { /* text-only card */ }
  }));
  return out;
}

/** Link to a stored (S3) video through the app's image proxy; null for anything else (raw CDN video links expire). */
export function videoHref(url: string): string | null {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base && isS3Url(url) ? `${base}/api/competitors/proxy-image?url=${encodeURIComponent(url)}` : null;
}

// One Chromium at a time: the cron builds several businesses' reports in parallel and a 2 GB task
// cannot hold several browsers. A failed render must not block the ones queued behind it.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function printToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    timeout: RENDER_TIMEOUT_MS,
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false); // the page needs none
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('about:')) void req.continue().catch(() => undefined);
      else void req.abort().catch(() => undefined); // rendering must not reach the network
    });
    await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: RENDER_TIMEOUT_MS });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** The report as an A4 PDF. Throws on failure — callers decide whether that matters. */
export async function renderReportPdf(row: ReportRow, businessName: string, locale?: BizLocale): Promise<Buffer> {
  const images = await inlineImages(reportMediaUrls(row));
  const html = buildReportHtml(row, { businessName, images, videoHref, locale });
  return serialized(async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        printToPdf(html),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('PDF render timed out')), RENDER_TIMEOUT_MS); }),
      ]);
    } finally { clearTimeout(timer); }
  });
}

/** Start date of the period in the business's timezone (Israel by default), `2026-11-01`. */
function periodDate(row: ReportRow, tz = 'Asia/Jerusalem'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(row.period_start));
  return parts; // en-CA is YYYY-MM-DD
}

/** ASCII attachment name: `cortexi-weekly-2026-11-01.pdf`. */
export const reportPdfFilename = (row: ReportRow, tz?: string) => `cortexi-${row.report_type}-${periodDate(row, tz)}.pdf`;

/** Stores the PDF in S3 at reports/<businessId>/<type>-<periodDate>.pdf. Null when S3 is off or the upload fails. */
export function storeReportPdf(businessId: string, row: ReportRow, pdf: Buffer, tz?: string): Promise<string | null> {
  return uploadObjectToS3(pdf, `reports/${businessId}/${row.report_type}-${periodDate(row, tz)}.pdf`, 'application/pdf');
}
