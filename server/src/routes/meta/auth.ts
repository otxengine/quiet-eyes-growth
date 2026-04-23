/**
 * Meta Auth Routes
 *
 * GET  /api/meta/auth/facebook/callback       — OAuth code → long-lived token → store MetaConnection
 * POST /api/meta/auth/whatsapp/embedded-signup — Embedded Signup code → store MetaConnection
 * GET  /api/meta/auth/connections/:bpId        — List connections for a business profile
 * DELETE /api/meta/auth/connections/:id        — Disconnect a Meta connection
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../../db';
import { encryptToken } from '../../lib/crypto';
import { metaApi } from '../../lib/metaApi';

const router = Router();

// ── Facebook Login for Business (OAuth Callback) ──────────────────────────────

/**
 * The frontend initiates Facebook Login with:
 *   https://www.facebook.com/v19.0/dialog/oauth?
 *     client_id=<META_APP_ID>
 *     &redirect_uri=<this endpoint>
 *     &state=<businessProfileId>        ← we use state to carry tenant context
 *     &scope=pages_messaging,pages_show_list,pages_read_engagement
 *
 * Meta redirects here with ?code=...&state=...
 */
router.get('/facebook/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;

  // User denied the permission dialog
  if (oauthError) {
    return res.redirect(`${process.env.FRONTEND_URL}/integrations?error=access_denied`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  const businessProfileId = state;

  try {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = `${process.env.FRONTEND_URL}/api/meta/auth/facebook/callback`;

    if (!appId || !appSecret) {
      return res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET not configured' });
    }

    // Step 1: Exchange authorization code → short-lived user access token
    const codeExchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?` + new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      redirect_uri:  redirectUri,
      code,
    });

    const tokenRes = await fetch(codeExchangeUrl);
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error('Facebook code exchange failed:', err);
      return res.redirect(`${process.env.FRONTEND_URL}/integrations?error=token_exchange_failed`);
    }
    const { access_token: shortToken } = await tokenRes.json() as any;

    // Step 2: Exchange short-lived → long-lived token (~60 days)
    const { token: longToken, expiresIn } = await metaApi.getLongLivedToken(shortToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Step 3: Fetch all pages the user manages (we get page-level tokens here)
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`
    );
    const pagesData: any = await pagesRes.json();
    const pages: any[]   = pagesData.data ?? [];

    if (pages.length === 0) {
      console.warn('Facebook OAuth: no pages found for user');
      return res.redirect(`${process.env.FRONTEND_URL}/integrations?error=no_pages_found`);
    }

    // Step 4: Store each page as a MetaConnection (upsert to handle re-auth)
    for (const page of pages) {
      const encryptedToken = encryptToken(page.access_token);

      await prisma.metaConnection.upsert({
        where:  { page_id: page.id },
        create: {
          business_profile_id: businessProfileId,
          platform:            'messenger',
          page_id:             page.id,
          encrypted_token:     encryptedToken,
          is_active:           true,
          token_expires_at:    expiresAt,
        },
        update: {
          encrypted_token:  encryptedToken,
          is_active:        true,
          token_expires_at: expiresAt,
        },
      });

      console.log(`Facebook Messenger connected: page ${page.id} for business ${businessProfileId}`);
    }

    return res.redirect(`${process.env.FRONTEND_URL}/integrations?meta_connected=messenger`);
  } catch (err: any) {
    console.error('Facebook OAuth callback error:', err.message);
    return res.redirect(`${process.env.FRONTEND_URL}/integrations?error=server_error`);
  }
});

// ── WhatsApp Embedded Signup ──────────────────────────────────────────────────

/**
 * Called by the frontend after the WhatsApp Embedded Signup JS SDK flow completes.
 * The SDK delivers a short-lived code + waba_id + phone_number_id.
 *
 * Body: { code, waba_id, phone_number_id, businessProfileId }
 */
router.post('/whatsapp/embedded-signup', async (req: Request, res: Response) => {
  const { code, waba_id, phone_number_id, businessProfileId } = req.body;

  if (!code || !waba_id || !phone_number_id || !businessProfileId) {
    return res.status(400).json({
      error: 'Required fields: code, waba_id, phone_number_id, businessProfileId',
    });
  }

  try {
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET not configured' });
    }

    // Step 1: Exchange Embedded Signup code → short-lived token
    const qs = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${qs}`);
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      return res.status(400).json({ error: 'Embedded Signup token exchange failed', detail: err });
    }
    const { access_token: shortToken } = await tokenRes.json() as any;

    // Step 2: Exchange for long-lived token
    const { token: longToken, expiresIn } = await metaApi.getLongLivedToken(shortToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Step 3: Subscribe this app to the WABA to receive webhook events
    await metaApi.subscribeToWABA(waba_id, longToken);

    // Step 4: Encrypt and persist the connection
    const encryptedToken = encryptToken(longToken);

    const connection = await prisma.metaConnection.upsert({
      where:  { phone_number_id },
      create: {
        business_profile_id: businessProfileId,
        platform:            'whatsapp',
        phone_number_id,
        waba_id,
        encrypted_token:     encryptedToken,
        is_active:           true,
        token_expires_at:    expiresAt,
      },
      update: {
        waba_id,
        encrypted_token:  encryptedToken,
        is_active:        true,
        token_expires_at: expiresAt,
      },
    });

    // Step 5: Create default lead-gen AI agent config if none exists for this connection
    const existingConfig = await prisma.aIAgentConfig.findFirst({
      where: { meta_connection_id: connection.id },
    });

    if (!existingConfig) {
      await prisma.aIAgentConfig.create({
        data: {
          meta_connection_id: connection.id,
          agent_type:         'lead_gen',
          system_prompt: [
            'You are a friendly AI sales assistant for a business.',
            'Your goals: understand the customer\'s need, qualify them (budget, timeline, service required), and collect their contact details.',
            'Always respond in the same language the customer uses.',
            'Be concise — WhatsApp messages should be short and conversational.',
            'If the customer asks to speak to a human or if you cannot help, say you will transfer them.',
          ].join(' '),
          handoff_keywords: 'human,manager,speak to someone,מנהל,מנהלת,אדם,נציג אנושי,עבור אנושי',
          is_active:        true,
          max_tokens:       400,
          temperature:      0.7,
        },
      });
    }

    console.log(`WhatsApp connected: phone ${phone_number_id}, WABA ${waba_id}, business ${businessProfileId}`);

    return res.json({
      success:         true,
      connection_id:   connection.id,
      phone_number_id,
      waba_id,
    });
  } catch (err: any) {
    console.error('WhatsApp Embedded Signup error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── List connections ──────────────────────────────────────────────────────────

router.get('/connections/:businessProfileId', async (req: Request, res: Response) => {
  try {
    const connections = await prisma.metaConnection.findMany({
      where: { business_profile_id: String(req.params.businessProfileId) },
      select: {
        id:              true,
        platform:        true,
        page_id:         true,
        phone_number_id: true,
        waba_id:         true,
        is_active:       true,
        token_expires_at: true,
        created_date:    true,
        // encrypted_token intentionally excluded
      },
    });
    return res.json(connections);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────

router.delete('/connections/:id', async (req: Request, res: Response) => {
  try {
    await prisma.metaConnection.update({
      where: { id: String(req.params.id) },
      data:  { is_active: false },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
