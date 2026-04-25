/**
 * WhatsAppExecutor — sends WhatsApp messages via Meta Cloud API.
 *
 * If the business has a connected WhatsApp (whatsapp_phone_number_id +
 * whatsapp_access_token), the message is sent directly.
 * Otherwise it falls back to creating a wa.me deep-link PendingAlert.
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';

const logger = createLogger('WhatsAppExecutor');

export interface WhatsAppMessage {
  to: string;          // recipient phone number (international format, digits only)
  text: string;        // message body
  leadId?: string;     // optional lead linkage for tracking
  customerName?: string;
}

export interface WhatsAppResult {
  sent: boolean;
  method: 'api' | 'pending_alert' | 'skipped';
  messageId?: string;
  error?: string;
}

export async function sendWhatsApp(
  businessProfileId: string,
  msg: WhatsAppMessage,
): Promise<WhatsAppResult> {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: {
      whatsapp_phone_number_id: true,
      whatsapp_access_token: true,
      name: true,
    },
  });

  const phone = msg.to.replace(/\D/g, '');
  if (!phone) return { sent: false, method: 'skipped', error: 'No phone number' };

  // Try Meta Cloud API if credentials are configured
  if (profile?.whatsapp_phone_number_id && profile?.whatsapp_access_token) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${profile.whatsapp_phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${profile.whatsapp_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: msg.text },
          }),
        },
      );

      if (res.ok) {
        const data = await res.json() as any;
        const messageId = data?.messages?.[0]?.id;
        logger.info('WhatsApp sent via API', { businessProfileId, phone, messageId });
        return { sent: true, method: 'api', messageId };
      }

      const errData = await res.json().catch(() => ({})) as any;
      logger.warn('WhatsApp API failed, falling back', { status: res.status, error: errData?.error?.message });
    } catch (err: any) {
      logger.warn('WhatsApp API error, falling back', { error: err.message });
    }
  }

  // Fallback: create a PendingAlert with wa.me URL (user sends manually)
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg.text)}`;
  await prisma.pendingAlert.create({
    data: {
      linked_business: businessProfileId,
      alert_type: 'whatsapp_send',
      message: msg.text,
      customer_name: msg.customerName || null,
      whatsapp_url: waUrl,
      phone,
      trigger_date: new Date().toISOString(),
      is_sent: false,
    },
  });

  logger.info('WhatsApp queued as PendingAlert', { businessProfileId, phone });
  return { sent: false, method: 'pending_alert' };
}
