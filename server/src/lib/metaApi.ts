/**
 * Meta Graph API Service
 *
 * Responsibilities:
 *  1. Send text messages via WhatsApp Cloud API and Facebook Messenger Send API.
 *  2. Implement the Messenger Handover Protocol (pass_thread_control → Page Inbox).
 *  3. Token management helpers (short → long-lived exchange, WABA subscription).
 *
 * All methods throw on non-2xx responses so callers can handle errors uniformly.
 */

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Well-known Meta app ID for the Facebook Page Inbox.
 * Used as the target app in pass_thread_control when handing off to a human agent.
 */
const PAGE_INBOX_APP_ID = '263902037430900';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SendTextOptions {
  platform: 'whatsapp' | 'messenger';
  recipientId: string;      // WhatsApp E.164 phone number or Messenger PSID
  phoneNumberId?: string;   // Required for WhatsApp
  pageId?: string;          // Required for Messenger (used in URL, not body)
  text: string;
  accessToken: string;
}

export interface HandoverOptions {
  recipientPsid: string;
  accessToken: string;
  targetAppId?: string;     // Defaults to PAGE_INBOX_APP_ID
  metadata?: string;        // Surfaced in the inbox as a note
}

export interface LongLivedTokenResult {
  token: string;
  expiresIn: number; // seconds (~5,183,944 for 60-day tokens)
}

// ── Service ───────────────────────────────────────────────────────────────────

export class MetaApiService {

  // ── Messaging ───────────────────────────────────────────────────────────────

  /**
   * Unified entry point — delegates to the correct platform send method.
   */
  async sendTextMessage(opts: SendTextOptions): Promise<void> {
    if (opts.platform === 'whatsapp') {
      await this._sendWhatsApp(opts);
    } else {
      await this._sendMessenger(opts);
    }
  }

  /**
   * WhatsApp Cloud API — POST /{phone-number-id}/messages
   */
  private async _sendWhatsApp(opts: SendTextOptions): Promise<void> {
    if (!opts.phoneNumberId) {
      throw new Error('phoneNumberId is required for WhatsApp messages');
    }

    const url  = `${GRAPH_BASE}/${opts.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: opts.recipientId,
      type: 'text',
      text: { preview_url: false, body: opts.text },
    };

    await this._post(url, body, opts.accessToken, 'Bearer');
  }

  /**
   * Messenger Send API — POST /me/messages
   */
  private async _sendMessenger(opts: SendTextOptions): Promise<void> {
    // Messenger uses the token as a query param, not a Bearer header
    const url  = `${GRAPH_BASE}/me/messages?access_token=${opts.accessToken}`;
    const body = {
      recipient:      { id: opts.recipientId },
      message:        { text: opts.text },
      messaging_type: 'RESPONSE',
    };

    await this._post(url, body);
  }

  // ── Handover Protocol ────────────────────────────────────────────────────────

  /**
   * Transfer thread control from this app to another app (default: Page Inbox).
   * Only applicable to Messenger. For WhatsApp, use session assignment in the API.
   * See: https://developers.facebook.com/docs/messenger-platform/handover-protocol
   */
  async passThreadControl(opts: HandoverOptions): Promise<void> {
    const url  = `${GRAPH_BASE}/me/pass_thread_control?access_token=${opts.accessToken}`;
    const body = {
      recipient:     { id: opts.recipientPsid },
      target_app_id: opts.targetAppId ?? PAGE_INBOX_APP_ID,
      metadata:      opts.metadata ?? 'Escalated by AI agent',
    };

    await this._post(url, body);
  }

  // ── Token Management ─────────────────────────────────────────────────────────

  /**
   * Exchange a short-lived user access token for a long-lived one (~60 days).
   * Called after both Facebook Login for Business and Embedded Signup flows.
   */
  async getLongLivedToken(shortLivedToken: string): Promise<LongLivedTokenResult> {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error('META_APP_ID and META_APP_SECRET must be set');
    }

    const qs = new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         appId,
      client_secret:     appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${qs}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Long-lived token exchange failed: ${JSON.stringify(err)}`);
    }

    const data: any = await res.json();
    return { token: data.access_token, expiresIn: data.expires_in ?? 5183944 };
  }

  /**
   * Subscribe this Meta app to a WABA so it receives webhook events.
   * Must be called once after WhatsApp Embedded Signup completes.
   */
  async subscribeToWABA(wabaId: string, accessToken: string): Promise<void> {
    const url = `${GRAPH_BASE}/${wabaId}/subscribed_apps`;
    await this._post(url, {}, accessToken, 'Bearer');
  }

  // ── Internal HTTP helper ─────────────────────────────────────────────────────

  private async _post(
    url: string,
    body: object,
    token?: string,
    authScheme: 'Bearer' | 'none' = 'none'
  ): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token && authScheme === 'Bearer') {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`Meta API ${res.status}: ${JSON.stringify(err)}`);
    }

    return res.json();
  }
}

// Singleton — import this everywhere instead of instantiating manually
export const metaApi = new MetaApiService();
