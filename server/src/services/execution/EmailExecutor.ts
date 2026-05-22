/**
 * EmailExecutor — sends transactional emails via SendGrid API.
 *
 * If SENDGRID_API_KEY is not configured, falls back to creating a
 * ProactiveAlert so the user can send the email manually.
 *
 * Usage contexts:
 *   - Lead follow-up emails
 *   - Review request emails
 *   - Weekly digest / campaign emails
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';

const logger = createLogger('EmailExecutor');

export interface EmailMessage {
  to:           string;    // recipient email
  subject:      string;
  body:         string;    // plain-text or HTML body
  fromName?:    string;    // sender display name (default: business name)
  fromEmail?:   string;    // sender email (default: SENDGRID_FROM_EMAIL)
  leadId?:      string;    // optional link for tracking
  customerName?: string;
}

export interface EmailResult {
  sent:      boolean;
  method:    'api' | 'pending_alert' | 'skipped';
  messageId?: string;
  error?:    string;
}

export async function sendEmail(
  businessProfileId: string,
  msg: EmailMessage,
): Promise<EmailResult> {
  if (!msg.to || !msg.to.includes('@')) {
    return { sent: false, method: 'skipped', error: 'Invalid email address' };
  }

  const apiKey    = process.env.SENDGRID_API_KEY || '';
  const fromEmail = msg.fromEmail || process.env.SENDGRID_FROM_EMAIL || 'noreply@otxengine.io';

  if (apiKey) {
    try {
      // Load business name for sender display
      const profile = await prisma.businessProfile.findUnique({
        where:  { id: businessProfileId },
        select: { name: true },
      });
      const fromName = msg.fromName || profile?.name || 'OTX Engine';

      const isHtml = msg.body.trim().startsWith('<');
      const sendBody = {
        personalizations: [{ to: [{ email: msg.to, name: msg.customerName }] }],
        from:    { email: fromEmail, name: fromName },
        subject: msg.subject,
        content: [{ type: isHtml ? 'text/html' : 'text/plain', value: msg.body }],
      };

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      });

      if (res.ok || res.status === 202) {
        const messageId = res.headers.get('x-message-id') || undefined;
        logger.info('Email sent via SendGrid', { businessProfileId, to: msg.to, messageId });
        return { sent: true, method: 'api', messageId };
      }

      const errData = await res.json().catch(() => ({})) as any;
      const errMsg  = errData?.errors?.[0]?.message || `SendGrid ${res.status}`;
      logger.warn('SendGrid failed, falling back to alert', { status: res.status, error: errMsg });
    } catch (err: any) {
      logger.warn('SendGrid error, falling back to alert', { error: err.message });
    }
  }

  // Fallback: create PendingAlert so user can copy-paste and send manually
  try {
    await prisma.pendingAlert.create({
      data: {
        linked_business: businessProfileId,
        alert_type:      'email_send',
        message:         `${msg.subject}\n\n${msg.body}`,
        customer_name:   msg.customerName || null,
        phone:           msg.to,           // re-use phone field for email
        trigger_date:    new Date().toISOString(),
        is_sent:         false,
      },
    });
  } catch (_) {}

  logger.info('Email queued as PendingAlert', { businessProfileId, to: msg.to });
  return { sent: false, method: 'pending_alert' };
}
