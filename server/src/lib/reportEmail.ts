import { esc } from './html';
import { sendEmail } from './email';
import type { ReportType } from './reportPeriod';

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

const h2 = (t: string) => `<h2 style="font-size:16px;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px solid ${C.grid};color:${C.ink}">${esc(t)}</h2>`;
const p = (t: unknown) => `<p style="margin:0 0 8px;line-height:1.6">${esc(t)}</p>`;
const list = (items: unknown[], tag: 'ul' | 'ol') =>
  `<${tag} style="margin:4px 0;padding-right:20px;padding-left:0">${items.map(i => `<li style="margin:4px 0;line-height:1.6">${esc(i)}</li>`).join('')}</${tag}>`;

const TOTAL_LABELS: Record<string, string> = { posts: 'פוסטים', stories: 'סטוריז', new_ads: 'מודעות חדשות', offers: 'מבצעים', reviews: 'ביקורות' };

/**
 * Table-based, inline-styled RTL HTML so it renders in Gmail/Outlook (no grid/flex, no <style>).
 * Every value from the report is escaped — captions, review text and LLM output are untrusted.
 */
export function buildReportEmail(
  report: { report_type: string; period_start: Date; period_end: Date; data: any; summary: any },
  businessName: string,
): { subject: string; html: string } {
  const type = report.report_type as ReportType;
  const d = report.data ?? {};
  const s = report.summary ?? {};
  const period = periodLabel(type, new Date(report.period_start), new Date(report.period_end));
  const subject = `דוח מתחרים ${LABEL[type]} · ${businessName} · ${period}`;

  const totals = Object.entries(d.totals ?? {}).filter(([k]) => TOTAL_LABELS[k]);
  const tiles = totals.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:12px 0"><tr>${totals.map(([k, v]) =>
    `<td style="border:1px solid ${C.grid};border-radius:6px;padding:8px 10px;text-align:right"><div style="font-size:22px;font-weight:700;color:${C.ink}">${esc(Number(v).toLocaleString('en-US'))}</div><div style="font-size:12px;color:${C.ink2}">${esc(TOTAL_LABELS[k])}</div></td>`).join('')}</tr></table>` : '';

  // Engagement bars: one row per competitor with any; the bar is a td sized in % (works in every client).
  const comps: any[] = Array.isArray(d.competitors) ? d.competitors : [];
  const eng = comps.map(c => ({ name: c.name, v: Number(c.posts?.total_engagement) || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
  const max = Math.max(1, ...eng.map(x => x.v));
  const bars = eng.length ? h2('מעורבות בפוסטים (לייקים + תגובות)') + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${eng.map(x => {
    const pct = Math.max(1, Math.round((x.v / max) * 100));
    return `<tr><td width="130" style="font-size:13px;color:${C.ink2};padding:3px 0 3px 8px;white-space:nowrap">${esc(x.name)}</td>`
      + `<td style="padding:3px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
      + `<td width="${pct}%" style="background:${C.comp};height:10px;font-size:0;line-height:0;border-radius:4px 0 0 4px">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table></td>`
      + `<td width="56" style="font-size:13px;color:${C.ink};text-align:left;padding:3px 8px 3px 0" dir="ltr">${esc(x.v.toLocaleString('en-US'))}</td></tr>`;
  }).join('')}</table>` : '';

  const own = d.own_reviews;
  const ownReviews = own && own.count ? h2('הביקורות שלכם') + p(`${own.count} ביקורות חדשות · ממוצע ${own.avg_rating ?? '—'} · ${own.negative ?? 0} שליליות · שיעור מענה ${own.reply_rate ?? 0}%`) : '';

  const rows = comps.map(c => `<tr>${[
    esc(c.name), c.posts?.count ?? 0, (c.posts?.total_engagement ?? 0).toLocaleString('en-US'), c.stories?.count ?? 0,
    `${c.ads?.new_count ?? 0}/${c.ads?.active_count ?? 0}`, c.offers?.count ?? 0,
    c.reviews ? `${c.reviews.count}${c.reviews.avg_rating != null ? ` (${c.reviews.avg_rating})` : ''}` : '—',
  ].map((v, i) => `<td style="padding:5px 6px;border-bottom:1px solid ${C.grid};font-size:12px;${i ? 'text-align:left' : ''}"${i ? ' dir="ltr"' : ''}>${i ? esc(v) : v}</td>`).join('')}</tr>`).join('');
  const table = comps.length ? h2('המספרים') + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${
    ['מתחרה', 'פוסטים', 'מעורבות', 'סטוריז', 'מודעות חדשות/פעילות', 'מבצעים', 'ביקורות (ממוצע)']
      .map((t, i) => `<th style="padding:5px 6px;border-bottom:1px solid #c3c2b7;font-size:12px;color:${C.ink2};font-weight:600;text-align:${i ? 'left' : 'right'}">${t}</th>`).join('')
  }</tr>${rows}</table>` : '';

  const perComp: any[] = Array.isArray(s.per_competitor) ? s.per_competitor : [];
  const changes: any[] = Array.isArray(d.changes) ? d.changes : [];

  const body = [
    `<div style="background:${C.tint};border-right:4px solid ${C.comp};padding:12px 14px;border-radius:4px;font-size:16px;font-weight:600;line-height:1.5">${esc(s.headline ?? '')}</div>`,
    tiles,
    Array.isArray(s.highlights) && s.highlights.length ? h2('עיקרי התקופה') + list(s.highlights, 'ul') : '',
    s.own_summary ? h2('הפעילות שלכם') + p(s.own_summary) : '',
    s.reviews_summary ? h2('ביקורות') + p(s.reviews_summary) : '',
    ownReviews,
    Array.isArray(s.recommended_actions) && s.recommended_actions.length ? h2('פעולות מומלצות') + list(s.recommended_actions, 'ol') : '',
    bars,
    changes.length ? h2('שינויים שזוהו') + list(changes.map(c => c.summary), 'ul') : '',
    perComp.length ? h2('לפי מתחרה') + perComp.map(c => `<p style="margin:0 0 8px;line-height:1.6"><b>${esc(c.name)}:</b> ${esc(c.summary)}</p>`).join('') : '',
    table,
    Array.isArray(d.limits) && d.limits.length ? h2('מגבלות המידע') + `<div style="font-size:12px;color:${C.ink2}">${list(d.limits, 'ul')}</div>` : '',
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

/** One Resend call per report to the whole list. No-op (false) when the list isn't configured. */
export async function sendReportEmail(
  report: Parameters<typeof buildReportEmail>[0],
  businessName: string,
): Promise<boolean> {
  const to = reportRecipients();
  if (!to.length) return false;
  const { subject, html } = buildReportEmail(report, businessName);
  return sendEmail({ to, subject, html });
}
