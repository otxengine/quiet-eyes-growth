/**
 * email.ts — Transactional email via Resend.
 * Falls back gracefully when RESEND_API_KEY is not set.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL || 'noreply@otxengine.io';
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://quiet-eyes-frontend.onrender.com';
const BACKEND_URL    = process.env.BACKEND_URL || 'http://localhost:3001';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — skipping email to ${opts.to}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to:   opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[email] Resend error:', err);
      return false;
    }
    console.log(`[email] Sent to ${opts.to}`);
    return true;
  } catch (e: any) {
    console.error('[email] Failed to send:', e.message);
    return false;
  }
}

export function buildInviteEmail(opts: {
  inviterName: string;
  orgName: string;
  role: string;
  inviteToken: string;
}): string {
  const ROLE_HE: Record<string, string> = {
    admin:          'מנהל',
    content_editor: 'עורך תוכן',
    viewer:         'צופה',
    manager:        'מנהל סניף',
  };
  const roleLabel = ROLE_HE[opts.role] || opts.role;
  const link = `${FRONTEND_URL}/join?token=${opts.inviteToken}`;

  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${BACKEND_URL}/cortexi-logo.jpeg" alt="Cortexi" style="height: 56px; width: auto; margin-bottom: 6px;" />
      <p style="margin: 0 0 12px 0; font-size: 12px; color: #888; letter-spacing: 0.3px;">Inspired by the brain. Built for intelligence</p>
      <h1 style="margin: 0; font-size: 22px; color: #111;">הוזמנת ל-${opts.orgName}</h1>
    </div>

    <p style="color: #444; font-size: 15px; line-height: 1.6; text-align: right;">
      ${opts.inviterName} הזמין אותך להצטרף לארגון <strong>${opts.orgName}</strong> בתפקיד <strong>${roleLabel}</strong>.
    </p>
    <p style="color: #444; font-size: 15px; line-height: 1.6; text-align: right;">
      לחץ על הכפתור להלן כדי להצטרף למערכת OTX Growth OS:
    </p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="background: #7c3aed; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: bold; display: inline-block;">
        הצטרף עכשיו
      </a>
    </div>

    <p style="color: #888; font-size: 12px; text-align: center; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
      קישור זה תקף ל-7 ימים. אם לא ציפית להזמנה זו, אפשר להתעלם ממייל זה.
    </p>
  </div>
</body>
</html>`;
}

export function buildApprovalEmail(opts: {
  actionDescription: string;
  agentName: string;
}): string {
  const approvalsUrl = `${FRONTEND_URL}/approvals`;
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 540px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${BACKEND_URL}/cortexi-logo.jpeg" alt="Cortexi" style="height: 56px; width: auto; margin-bottom: 6px;" />
      <p style="margin: 0 0 12px 0; font-size: 12px; color: #888; letter-spacing: 0.3px;">Inspired by the brain. Built for intelligence</p>
      <h1 style="margin: 0; font-size: 20px; color: #111;">פעולה חדשה ממתינה לאישורך</h1>
    </div>

    <div style="background: #f8f5ff; border-right: 4px solid #7c3aed; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: right;">
      <p style="margin: 0 0 6px 0; font-size: 12px; color: #7c3aed; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
        ${opts.agentName}
      </p>
      <p style="margin: 0; font-size: 15px; color: #222; line-height: 1.6;">${opts.actionDescription}</p>
    </div>

    <p style="color: #555; font-size: 14px; text-align: right; margin-bottom: 28px; line-height: 1.6;">
      הסוכן הבינותי שלך הכין פעולה שדורשת את אישורך. לחץ על הכפתור להלן כדי לצפות ולאשר או לדחות.
    </p>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${approvalsUrl}"
         style="background: #7c3aed; color: white; text-decoration: none; padding: 14px 40px; border-radius: 10px; font-size: 15px; font-weight: bold; display: inline-block;">
        צפה בפעולה
      </a>
    </div>

    <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px; line-height: 1.6;">
      אם לא ציפית להודעה זו, אפשר להתעלם ממייל זה.
    </p>
  </div>
</body>
</html>`;
}

export { FRONTEND_URL };
