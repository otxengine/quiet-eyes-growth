import { esc } from './html';
import { sendEmail } from './email';
import type { ReportType } from './reportPeriod';
import { reportKpis } from './reportPdf/html';

// Internal distribution list for every generated report, from SSM (/qe/<env>/REPORT_EMAIL_RECIPIENTS),
// comma-separated. Kept out of the code because the repo is public.
export function reportRecipients(raw = process.env.REPORT_EMAIL_RECIPIENTS): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(s => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s));
}

const LABEL: Record<ReportType, string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };
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
 * Short table-based, inline-styled RTL email (Gmail/Outlook: no grid/flex, no <style>): the masthead, the
 * one-line headline and the non-zero KPI numbers. The full report is the PDF attached to it.
 * Every value from the report is escaped — LLM output and scraped names are untrusted.
 */
export function buildReportEmail(
  report: { report_type: string; period_start: Date; period_end: Date; data: any; summary: any },
  businessName: string,
  hasPdf = true,
): { subject: string; html: string } {
  const type = report.report_type as ReportType;
  const s = report.summary ?? {};
  const period = periodLabel(type, new Date(report.period_start), new Date(report.period_end));
  const subject = `דוח מתחרים ${LABEL[type]} · ${businessName} · ${period}`;

  const { on } = reportKpis(report.data);
  const tiles = on.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:12px 0"><tr>${on.map(([label, v]) =>
    `<td style="border:1px solid ${C.grid};border-radius:6px;padding:8px 10px;text-align:right"><div style="font-size:22px;font-weight:700;color:${C.ink}">${esc(Number(v).toLocaleString('en-US'))}</div><div style="font-size:12px;color:${C.ink2}">${esc(label)}</div></td>`).join('')}</tr></table>` : '';

  const body = [
    `<div style="background:${C.tint};border-right:4px solid ${C.comp};padding:12px 14px;border-radius:4px;font-size:16px;font-weight:600;line-height:1.5">${esc(s.headline ?? '')}</div>`,
    tiles,
    // Only promise an attachment that is actually there (a failed render still sends this email).
    hasPdf ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:${C.ink2}">הדוח המלא מצורף כקובץ PDF</p>` : '',
  ].join('');

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:680px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,'Arial Hebrew',sans-serif;color:${C.ink};font-size:14px;text-align:right">
<tr><td style="padding:24px 28px;border-bottom:2px solid ${C.ink}">
<div style="font-size:13px;color:${C.ink2}">Cortexi · ${esc(businessName)}</div>
<div style="font-size:24px;font-weight:700;margin-top:2px">דוח מתחרים ${LABEL[type]}</div>
<div style="font-size:14px;color:${C.ink2}">${esc(period)}</div></td></tr>
<tr><td style="padding:20px 28px">${body}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid ${C.grid};font-size:11px;color:${C.muted}">נשלח אוטומטית ע״י Cortexi עם יצירת הדוח · רשימת תפוצה פנימית</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html };
}

/**
 * One Resend call per report to the whole list, with the PDF attached when there is one (a failed
 * render still sends the short email). No-op (false) when the list isn't configured.
 */
export async function sendReportEmail(
  report: Parameters<typeof buildReportEmail>[0],
  businessName: string,
  pdf?: { filename: string; content: Buffer } | null,
): Promise<boolean> {
  const to = reportRecipients();
  if (!to.length) return false;
  const { subject, html } = buildReportEmail(report, businessName, !!pdf);
  return sendEmail({
    to, subject, html,
    ...(pdf && { attachments: [{ filename: pdf.filename, content: pdf.content.toString('base64') }] }),
  });
}
