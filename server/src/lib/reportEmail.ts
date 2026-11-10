import { esc } from './html';
import { sendEmail } from './email';
import type { ReportType } from './reportPeriod';
import { reportKpis, reportPeriodLabel } from './reportPdf/html';
import type { BizLocale } from './locale';
import { customerRecipients, reportViewUrl, unsubscribeUrl } from './reportDelivery';

// Internal distribution list for every generated report, from SSM (/qe/<env>/REPORT_EMAIL_RECIPIENTS),
// comma-separated. Kept out of the code because the repo is public.
export function reportRecipients(raw = process.env.REPORT_EMAIL_RECIPIENTS): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(s => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s));
}

const LABEL: Record<ReportType, string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };
const LABEL_EN: Record<ReportType, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const C = { ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', comp: '#2a78d6', tint: '#eef4fc' };
const il = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', ...o }).format(d);

/** "7 בנובמבר 2026" / "1–7 בנובמבר 2026" / "אוקטובר 2026" — end is exclusive. */
export function periodLabel(type: ReportType, start: Date, end: Date): string {
  const last = new Date(end.getTime() - 1);
  if (type === 'daily') return il(start, { day: 'numeric', month: 'long', year: 'numeric' });
  if (type === 'monthly') return il(start, { month: 'long', year: 'numeric' });
  return `${il(start, { day: 'numeric' })}–${il(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/**
 * Short table-based, inline-styled email in the business's language (RTL Hebrew by default, LTR English) (Gmail/Outlook: no grid/flex, no <style>): the masthead, the
 * one-line headline and the non-zero KPI numbers. The full report is the web page behind `viewUrl`
 * (and/or the attached PDF). Every value from the report is escaped — LLM output and scraped names are untrusted.
 */
export function buildReportEmail(
  report: { id?: string; report_type: string; period_start: Date; period_end: Date; data: any; summary: any },
  businessName: string,
  hasPdf = true,
  loc?: BizLocale,
  // Set for an email to the customer: it must say why they get it and how to stop it.
  // Omitted = the internal distribution list.
  customer?: { unsubscribeUrl: string; postalAddress?: string },
  // Signed link to the web report (reportViewUrl): the "Open the full report" button.
  viewUrl?: string | null,
): { subject: string; html: string } {
  const type = report.report_type as ReportType;
  const s = report.summary ?? {};
  const en = loc?.lang === 'en';
  const side = en ? 'left' : 'right';
  const dir = en ? 'ltr' : 'rtl';
  const period = en
    ? reportPeriodLabel(type, report.period_start, report.period_end, loc)
    : periodLabel(type, new Date(report.period_start), new Date(report.period_end));
  const title = en ? `${LABEL_EN[type]} competitor report` : `דוח מתחרים ${LABEL[type]}`;
  const subject = `${title} · ${businessName} · ${period}`;

  const footer = customer
    ? `${en
      ? `You are receiving this because ${esc(businessName)} is subscribed to Cortexi competitor reports.`
      : `קיבלת מייל זה כי ${esc(businessName)} רשום לדוחות המתחרים של Cortexi.`}`
      + ` <a href="${esc(customer.unsubscribeUrl)}" style="color:${C.muted}">${en ? 'Unsubscribe' : 'הסרה מרשימת התפוצה'}</a>`
      + (customer.postalAddress ? `<br>${esc(customer.postalAddress)}` : '')
    : en ? 'Sent automatically by Cortexi when the report was generated · internal distribution list'
      : 'נשלח אוטומטית ע״י Cortexi עם יצירת הדוח · רשימת תפוצה פנימית';

  const { on } = reportKpis(report.data, en ? 'en' : 'he');
  const tiles = on.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:12px 0"><tr>${on.map(([label, v]) =>
    `<td style="border:1px solid ${C.grid};border-radius:6px;padding:8px 10px;text-align:${side}"><div style="font-size:22px;font-weight:700;color:${C.ink}">${esc(typeof v === 'number' ? v.toLocaleString('en-US') : v)}</div><div style="font-size:12px;color:${C.ink2}">${esc(label)}</div></td>`).join('')}</tr></table>` : '';

  const body = [
    `<div style="background:${C.tint};border-${side}:4px solid ${C.comp};padding:12px 14px;border-radius:4px;font-size:16px;font-weight:600;line-height:1.5">${esc(s.headline ?? '')}</div>`,
    tiles,
    viewUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0"><tr><td style="background:${C.ink};border-radius:6px">`
      + `<a href="${esc(viewUrl)}" style="display:inline-block;padding:11px 20px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${en ? 'Open the full report' : 'לדוח המלא'}</a></td></tr></table>` : '',
    // Only promise an attachment that is actually there (a failed render still sends this email).
    hasPdf ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${C.ink2}">${en ? 'The full report is attached as a PDF' : 'הדוח המלא מצורף כקובץ PDF'}</p>` : '',
  ].join('');

  const html = `<!doctype html><html lang="${en ? 'en' : 'he'}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:680px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,'Arial Hebrew',sans-serif;color:${C.ink};font-size:14px;text-align:${side}">
<tr><td style="padding:24px 28px;border-bottom:2px solid ${C.ink}">
<div style="font-size:13px;color:${C.ink2}">Cortexi · ${esc(businessName)}</div>
<div style="font-size:24px;font-weight:700;margin-top:2px">${title}</div>
<div style="font-size:14px;color:${C.ink2}">${esc(period)}</div></td></tr>
<tr><td style="padding:20px 28px">${body}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid ${C.grid};font-size:11px;color:${C.muted}">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html };
}

/**
 * One Resend call per report to the whole internal list, then one per customer recipient, with the PDF
 * attached when there is one (a failed render still sends the short email). False when nobody was sent to.
 */
export async function sendReportEmail(
  report: Parameters<typeof buildReportEmail>[0],
  businessName: string,
  pdf?: { filename: string; content: Buffer } | null,
  loc?: BizLocale,
  // With it, the business's own recipients (business_profiles.report_recipients) get the report too.
  businessProfileId?: string,
): Promise<boolean> {
  const attachments = pdf && { attachments: [{ filename: pdf.filename, content: pdf.content.toString('base64') }] };
  const viewUrl = report.id ? reportViewUrl(report.id) : null;
  let sent = false;

  const internal = reportRecipients();
  if (internal.length) {
    const { subject, html } = buildReportEmail(report, businessName, !!pdf, loc, undefined, viewUrl);
    sent = await sendEmail({ to: internal, subject, html, ...attachments });
  }

  // One email per customer recipient: each carries its own unsubscribe link. No link (signing secret
  // or public URL not configured) means no customer email at all — never send one without it.
  const customers = businessProfileId ? (await customerRecipients(businessProfileId)).filter(e => !internal.includes(e)) : [];
  for (const to of customers) {
    const url = unsubscribeUrl(businessProfileId!, to);
    if (!url) {
      console.warn('[reportEmail] REPORT_UNSUBSCRIBE_SECRET or FRONTEND_URL not set — customer report email skipped');
      break;
    }
    // The web report replaces the attachment for customers; the PDF is a button on that page.
    const attach = viewUrl ? undefined : attachments;
    const { subject, html } = buildReportEmail(report, businessName, !!attach, loc,
      { unsubscribeUrl: url, postalAddress: process.env.COMPANY_POSTAL_ADDRESS }, viewUrl);
    const ok = await sendEmail({
      to, subject, html, ...attach,
      headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    sent = ok || sent;
  }
  return sent;
}
