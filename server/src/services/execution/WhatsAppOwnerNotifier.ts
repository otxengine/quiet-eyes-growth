/**
 * WhatsAppOwnerNotifier — sends WhatsApp notifications to the business owner.
 * Completely separate from WhatsAppExecutor which sends messages to customers.
 *
 * Used for: pending_approval action notifications → owner clicks link → /approvals page
 */

import { prisma } from '../../db';
import { createLogger } from '../../infra/logger';

const logger = createLogger('WhatsAppOwnerNotifier');

const FRONTEND_URL = process.env.FRONTEND_URL || '';

export async function sendOwnerWhatsAppNotification(opts: {
  businessProfileId: string;
  actionDescription: string;
  agentName: string;
}): Promise<void> {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: opts.businessProfileId },
    select: {
      phone: true,
      whatsapp_phone_number_id: true,
      whatsapp_access_token: true,
    },
  });

  const ownerPhone = profile?.phone?.replace(/\D/g, '');
  if (!ownerPhone) {
    logger.info('No owner phone found — skipping WhatsApp notification', { businessProfileId: opts.businessProfileId });
    return;
  }

  if (!profile?.whatsapp_phone_number_id || !profile?.whatsapp_access_token) {
    logger.info('No WhatsApp credentials — skipping owner notification', { businessProfileId: opts.businessProfileId });
    return;
  }

  const message = buildOwnerMessage(opts.agentName, opts.actionDescription);

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
          to: ownerPhone,
          type: 'text',
          text: { body: message },
        }),
      },
    );

    if (res.ok) {
      logger.info('Owner WhatsApp notification sent', { businessProfileId: opts.businessProfileId, phone: ownerPhone });
    } else {
      const err = await res.json().catch(() => ({})) as any;
      logger.warn('Owner WhatsApp notification failed', { status: res.status, error: err?.error?.message });
    }
  } catch (err: any) {
    logger.warn('Owner WhatsApp notification error', { error: err.message });
  }
}

function buildOwnerMessage(agentName: string, actionDescription: string): string {
  return `🔔 OTX: פעולה חדשה ממתינה לאישורך

סוכן: ${agentName}
פעולה: ${actionDescription}

לצפייה ואישור:
${FRONTEND_URL}/approvals`;
}
