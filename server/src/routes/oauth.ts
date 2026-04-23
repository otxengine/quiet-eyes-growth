/**
 * OAuth 2.0 router — /api/oauth
 *
 * Endpoints:
 *   GET  /api/oauth/initiate/:platform?businessId=...
 *   GET  /api/oauth/callback/:platform
 *   POST /api/oauth/disconnect
 *
 * Supported platforms: facebook_page | instagram_business | tiktok_business
 *
 * Tokens are stored in the `social_accounts` table (SocialAccount model).
 * The frontend reads back via GET /api/entities/SocialAccount?linked_business=...
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../db';

const router = Router();

// ── Env ──────────────────────────────────────────────────────────────────────
const FACEBOOK_APP_ID      = process.env.FACEBOOK_APP_ID      || '';
const FACEBOOK_APP_SECRET  = process.env.FACEBOOK_APP_SECRET  || '';
const TIKTOK_CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY    || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'http://localhost:5173';
const SERVER_BASE_URL      = process.env.SERVER_BASE_URL      || 'http://localhost:3002';

// In-memory state store (replace with Redis/DB in production for multi-instance)
const stateStore = new Map<string, { businessId: string; platform: string; expiresAt: number }>();

function generateState(platform: string, businessId: string): string {
  const state = randomBytes(16).toString('hex');
  stateStore.set(state, { businessId, platform, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function consumeState(state: string): { businessId: string; platform: string } | null {
  const entry = stateStore.get(state);
  if (!entry || entry.expiresAt < Date.now()) {
    stateStore.delete(state);
    return null;
  }
  stateStore.delete(state);
  return entry;
}

function callbackUrl(platform: string): string {
  return `${SERVER_BASE_URL}/api/oauth/callback/${platform}`;
}

// Upsert a SocialAccount record (no unique index on linked_business+platform, so findFirst+update/create)
async function upsertSocialAccount(
  businessId: string,
  platform: string,
  data: { account_name: string; access_token: string; page_id?: string },
) {
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform },
  });
  if (existing) {
    await prisma.socialAccount.update({
      where: { id: existing.id },
      data: { ...data, is_connected: true, last_sync: new Date().toISOString() },
    });
  } else {
    await prisma.socialAccount.create({
      data: {
        linked_business: businessId,
        platform,
        ...data,
        is_connected: true,
        last_sync: new Date().toISOString(),
      },
    });
  }
}

// ── Initiate OAuth ────────────────────────────────────────────────────────────
router.get('/initiate/:platform', (req: Request, res: Response) => {
  const { platform } = req.params;
  const businessId   = String(req.query.businessId || '');

  if (!businessId) return res.status(400).json({ error: 'Missing businessId' });

  const state = generateState(String(platform), String(businessId));

  let authUrl: string;

  if (platform === 'facebook_page' || platform === 'instagram_business') {
    if (!FACEBOOK_APP_ID) {
      return res.status(503).json({ error: 'Facebook app not configured', demo: true });
    }
    const scope = platform === 'instagram_business'
      ? 'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments'
      : 'pages_show_list,pages_manage_posts,pages_read_engagement,pages_messaging';

    authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}` +
      `&response_type=code`;

  } else if (platform === 'tiktok_business') {
    if (!TIKTOK_CLIENT_KEY) {
      return res.status(503).json({ error: 'TikTok app not configured', demo: true });
    }
    authUrl =
      `https://www.tiktok.com/auth/authorize/?` +
      `client_key=${TIKTOK_CLIENT_KEY}` +
      `&scope=user.info.basic,video.upload,video.publish` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&state=${state}`;
  } else {
    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  }

  return res.json({ url: authUrl, state });
});

// ── Facebook / Instagram callback ─────────────────────────────────────────────
async function handleFacebookCallback(code: string, platform: string, businessId: string) {
  const redirectUri = callbackUrl(platform);

  // 1. Exchange code → short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
  );
  if (!tokenRes.ok) throw new Error('Token exchange failed');
  const tokenData: any = await tokenRes.json();
  const shortLivedToken = tokenData.access_token;

  // 2. Extend to long-lived user token
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}` +
    `&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${shortLivedToken}`,
  );
  const longData: any = longRes.ok ? await longRes.json() : {};
  const userToken = longData.access_token || shortLivedToken;

  // 3. Get list of managed pages
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`,
  );
  const pagesData: any = pagesRes.ok ? await pagesRes.json() : {};
  const pages: any[] = pagesData?.data || [];

  if (pages.length === 0) throw new Error('No Facebook Pages found for this account');

  const page      = pages[0];
  const pageToken = page.access_token;
  const pageId    = page.id;
  const pageName  = page.name;

  // 4. For Instagram: get linked Instagram Business Account ID and store separately
  if (platform === 'instagram_business') {
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`,
    );
    const igData: any = igRes.ok ? await igRes.json() : {};
    const igId = igData?.instagram_business_account?.id ?? null;

    await upsertSocialAccount(businessId, 'instagram_business', {
      account_name: pageName,
      access_token: pageToken,
      page_id: igId ?? pageId,
    });
  } else {
    await upsertSocialAccount(businessId, 'facebook_page', {
      account_name: pageName,
      access_token: pageToken,
      page_id: pageId,
    });
  }

  return { page_name: pageName, platform };
}

// ── TikTok callback ───────────────────────────────────────────────────────────
async function handleTikTokCallback(code: string, businessId: string) {
  const tokenRes = await fetch('https://open-api.tiktok.com/oauth/access_token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  callbackUrl('tiktok_business'),
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error('TikTok token exchange failed');
  const tokenData: any = await tokenRes.json();
  const { access_token, open_id, display_name } = tokenData?.data || {};

  await upsertSocialAccount(businessId, 'tiktok_business', {
    account_name: display_name || 'TikTok Account',
    access_token: access_token || '',
    page_id:      open_id,
  });

  return { platform: 'tiktok_business', page_name: display_name };
}

// ── Callback route ────────────────────────────────────────────────────────────
router.get('/callback/:platform', async (req: Request, res: Response) => {
  const { platform }             = req.params;
  const { code, state, error }   = req.query as Record<string, string>;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/integrations?oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/integrations?oauth_error=missing_params`);
  }

  const stateData = consumeState(state);
  if (!stateData) {
    return res.redirect(`${FRONTEND_URL}/integrations?oauth_error=invalid_state`);
  }

  try {
    let result: any;
    if (platform === 'facebook_page' || platform === 'instagram_business') {
      result = await handleFacebookCallback(code, platform, stateData.businessId);
    } else if (platform === 'tiktok_business') {
      result = await handleTikTokCallback(code, stateData.businessId);
    } else {
      return res.redirect(`${FRONTEND_URL}/integrations?oauth_error=unknown_platform`);
    }

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><title>חיבור הצליח</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4}
.box{text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
h2{color:#10b981;margin-bottom:8px}p{color:#6b7280;font-size:14px}
</style></head>
<body><div class="box">
<h2>✓ ${result.page_name || 'החיבור'} הצליח!</h2>
<p>החלון יסגר אוטומטית...</p>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'oauth_success', platform: '${platform}' }, '*');
  }
  setTimeout(function(){ window.close(); }, 1500);
</script></body></html>`;
    return res.send(html);

  } catch (err: any) {
    console.error(`[oauth/${platform}] callback error:`, err.message);
    const safeMsgHtml = String(err.message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="UTF-8"><title>שגיאה</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#fef2f2}
.box{text-align:center;padding:40px;background:white;border-radius:16px}h2{color:#ef4444}
</style></head>
<body><div class="box"><h2>שגיאה בחיבור</h2><p>${safeMsgHtml}</p></div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'oauth_error', error: '${err.message.replace(/'/g, "\\'")}' }, '*');
  }
  setTimeout(function(){ window.close(); }, 2500);
</script></body></html>`;
    return res.send(html);
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────
router.post('/disconnect', async (req: Request, res: Response) => {
  const { businessId, platform } = req.body;
  if (!businessId || !platform) return res.status(400).json({ error: 'Missing params' });

  try {
    const account = await prisma.socialAccount.findFirst({
      where: { linked_business: businessId, platform },
    });
    if (account) {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { is_connected: false, access_token: null },
      });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
