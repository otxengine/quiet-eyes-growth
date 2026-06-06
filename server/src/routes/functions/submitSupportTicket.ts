import { Request, Response } from 'express';
import { sendEmail } from '../../lib/email';

const SUPPORT_NOTIFY_EMAIL = process.env.SUPPORT_NOTIFY_EMAIL || 'contact@otxengine.io';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://quiet-eyes-frontend.onrender.com';

function buildSupportEmail(opts: {
  userEmail: string;
  businessId: string;
  description: string;
  hasRecording: boolean;
  submittedAt: string;
}): string {
  const adminUrl = `${FRONTEND_URL}/admin-dashboard`;
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #E8344D, #FF6B6B); padding: 24px 32px; text-align: right;">
      <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">OTX Support</p>
      <h1 style="margin: 4px 0 0; color: #fff; font-size: 20px;">פנייה חדשה לתמיכה טכנית</h1>
    </div>

    <!-- Body -->
    <div style="padding: 28px 32px;">

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; font-size: 13px; width: 140px;">מייל משתמש</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #111; font-size: 13px; font-weight: 600;">${opts.userEmail || 'לא זמין'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; font-size: 13px;">מזהה עסק</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #111; font-size: 13px; font-family: monospace;">${opts.businessId || '—'}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; font-size: 13px;">זמן הפנייה</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #111; font-size: 13px;">${opts.submittedAt}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #888; font-size: 13px;">הקלטת מסך</td>
          <td style="padding: 10px 0; color: #111; font-size: 13px;">${opts.hasRecording ? '✅ כן — זמינה בדשבורד' : '❌ לא'}</td>
        </tr>
      </table>

      <!-- Description -->
      <div style="background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: right;">
        <p style="margin: 0 0 8px; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">תיאור הבעיה</p>
        <p style="margin: 0; color: #333; font-size: 14px; line-height: 1.6;">${opts.description}</p>
      </div>

      <!-- CTA -->
      <div style="text-align: center;">
        <a href="${adminUrl}" style="display: inline-block; background: #E8344D; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: bold;">
          פתח בדשבורד Admin ←
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #f8f8f8; padding: 16px 32px; text-align: center; border-top: 1px solid #eee;">
      <p style="margin: 0; color: #aaa; font-size: 11px;">OTX Engine · מייל אוטומטי ממערכת התמיכה</p>
    </div>
  </div>
</body>
</html>`;
}

export async function submitSupportTicket(req: Request, res: Response) {
  const { description, userEmail, businessId, hasRecording } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Missing description' });
  }

  const submittedAt = new Date().toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Send email notification
  await sendEmail({
    to: SUPPORT_NOTIFY_EMAIL,
    subject: `🔴 פנייה חדשה לתמיכה — ${userEmail || 'משתמש לא מזוהה'}`,
    html: buildSupportEmail({ userEmail, businessId, description, hasRecording: !!hasRecording, submittedAt }),
  });

  return res.json({ ok: true });
}
