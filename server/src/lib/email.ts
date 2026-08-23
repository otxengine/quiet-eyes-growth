/**
 * email.ts — Transactional email via Resend.
 * Falls back gracefully when RESEND_API_KEY is not set.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL || 'noreply@otxengine.io';
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://quiet-eyes-frontend.onrender.com';

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
      <div style="width: 48px; height: 48px; background: #7c3aed; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
        <span style="color: white; font-size: 24px; font-weight: bold;">OTX</span>
      </div>
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

export { FRONTEND_URL };
