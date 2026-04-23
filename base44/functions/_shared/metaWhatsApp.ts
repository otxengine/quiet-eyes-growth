// Meta Cloud API sender — real WhatsApp messages
// Falls back to wa.me link if credentials are missing

function normalizePhone(phone: string): string {
  const normalized = phone.replace(/[^0-9]/g, '');
  return normalized.startsWith('972') ? normalized
    : normalized.startsWith('0') ? '972' + normalized.slice(1)
    : normalized.length > 8 ? normalized : '972' + normalized;
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  toPhone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; waLink: string; error?: string }> {
  const intl = normalizePhone(toPhone);
  const waLink = `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;

  if (!phoneNumberId || !accessToken) {
    return { success: false, waLink, error: 'No Meta credentials — use wa.me link' };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: intl,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      console.error('[metaWhatsApp] Send failed:', JSON.stringify(data.error || data));
      return { success: false, waLink, error: data.error?.message || `HTTP ${res.status}` };
    }

    const messageId = data.messages?.[0]?.id;
    console.log(`[metaWhatsApp] Sent to ${intl}, messageId: ${messageId}`);
    return { success: true, messageId, waLink };
  } catch (err: any) {
    console.error('[metaWhatsApp] Exception:', err.message);
    return { success: false, waLink, error: err.message };
  }
}

// Send an interactive message with buttons (max 3 buttons, max 20 chars each)
export async function sendInteractiveButtons(
  phoneNumberId: string,
  accessToken: string,
  toPhone: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<{ success: boolean; waLink: string; error?: string }> {
  const intl = normalizePhone(toPhone);
  const waLink = `https://wa.me/${intl}?text=${encodeURIComponent(bodyText)}`;

  if (!phoneNumberId || !accessToken) {
    return { success: false, waLink, error: 'No Meta credentials' };
  }

  const limitedButtons = buttons.slice(0, 3); // Meta limit: 3 buttons max

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: intl,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: limitedButtons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) }, // Meta: max 20 chars
            })),
          },
        },
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      // Fall back to plain text if interactive fails (e.g. not on template-approved number)
      console.warn('[metaWhatsApp] Interactive failed, falling back to text:', data.error?.message);
      const fallback = await sendWhatsAppMessage(phoneNumberId, accessToken, toPhone, bodyText);
      return { success: fallback.success, waLink, error: data.error?.message };
    }

    return { success: true, waLink };
  } catch (err: any) {
    console.error('[metaWhatsApp] Interactive exception:', err.message);
    return { success: false, waLink, error: err.message };
  }
}

export function buildWaLink(phone: string, message: string): string {
  const intl = normalizePhone(phone);
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}
