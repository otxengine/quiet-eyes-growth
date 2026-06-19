/**
 * OAuth 2.0 router — /api/oauth
 *
 * Endpoints:
 *   GET  /api/oauth/initiate/:platform?businessId=...
 *   GET  /api/oauth/callback/:platform
 *   POST /api/oauth/disconnect
 *
 * Supported platforms: facebook_page | instagram_business | tiktok_business | google_business
 *
 * Tokens are stored in the `social_accounts` table (SocialAccount model)
 * AND mirrored into BusinessProfile fields so executors can read them directly.
 *
 * State is persisted in the `oauth_state_store` DB table (created at startup)
 * to survive server restarts and multi-instance deployments.
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../db';

const router = Router();

// ── Env — read lazily so dotenv has time to load ─────────────────────────────
// FACEBOOK_APP_ID and META_APP_ID are the same Meta app — support both names.
const env = () => {
  const fbId     = process.env.FACEBOOK_APP_ID     || process.env.META_APP_ID      || '';
  const fbSecret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET  || '';
  return {
    FACEBOOK_APP_ID:      fbId,
    FACEBOOK_APP_SECRET:  fbSecret,
    TIKTOK_CLIENT_KEY:    process.env.TIKTOK_CLIENT_KEY    || '',
    TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET || '',
    GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    FRONTEND_URL:         process.env.FRONTEND_URL         || 'http://localhost:5173',
    SERVER_BASE_URL:      process.env.SERVER_BASE_URL      || 'http://localhost:3007',
  };
};

// ── DB-backed state store — survives restarts and multi-instance deployments ──
// Table: oauth_state_store (id TEXT PK, business_id TEXT, platform TEXT, expires_at TIMESTAMPTZ)
// Created at server startup (see index.ts).

async function generateState(platform: string, businessId: string): Promise<string> {
  const state     = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO oauth_state_store (id, business_id, platform, expires_at) VALUES ($1,$2,$3,$4::timestamptz)
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      state, businessId, platform, expiresAt,
    );
  } catch {
    // Table might not exist yet on first run — fall through (state validation will fail gracefully)
  }
  return state;
}

async function consumeState(state: string): Promise<{ businessId: string; platform: string } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ business_id: string; platform: string; expires_at: string }>>(
      `DELETE FROM oauth_state_store WHERE id=$1 RETURNING business_id, platform, expires_at`,
      state,
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) return null;
    return { businessId: row.business_id, platform: row.platform };
  } catch {
    return null;
  }
}

function callbackUrl(platform: string): string {
  return `${env().SERVER_BASE_URL}/api/oauth/callback/${platform}`;
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
router.get('/initiate/:platform', async (req: Request, res: Response) => {
  const { platform } = req.params;
  const businessId   = String(req.query.businessId || '');

  if (!businessId) return res.status(400).json({ error: 'Missing businessId' });

  // WhatsApp requires the Embedded Signup SDK — not a standard OAuth redirect.
  // Return a signal to the frontend to show the Embedded Signup button instead.
  if (platform === 'whatsapp_business') {
    return res.json({
      whatsapp_embedded_signup: true,
      message: 'WhatsApp requires the Embedded Signup flow — use the dedicated WhatsApp connect button.',
    });
  }

  const state = await generateState(String(platform), String(businessId));
  let authUrl: string;

  if (platform === 'facebook_page' || platform === 'instagram_business') {
    if (!env().FACEBOOK_APP_ID) {
      return res.status(503).json({ error: 'Facebook app not configured', demo: true });
    }

    // instagram_content_publish is required for media publish
    // pages_manage_posts is required for Facebook feed/photos
    const scope = platform === 'instagram_business'
      ? 'pages_show_list,pages_read_engagement,instagram_content_publish,instagram_basic'
      : 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement';

    authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${env().FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}` +
      `&response_type=code`;

  } else if (platform === 'tiktok_business') {
    if (!env().TIKTOK_CLIENT_KEY) {
      return res.status(503).json({ error: 'TikTok app not configured', demo: true });
    }
    // TikTok Content Posting API v2 scopes
    authUrl =
      `https://www.tiktok.com/v2/auth/authorize/?` +
      `client_key=${env().TIKTOK_CLIENT_KEY}` +
      `&scope=${encodeURIComponent('user.info.basic,video.upload,video.publish,video.list')}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&state=${state}`;

  } else if (platform === 'google_business') {
    if (!env().GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google app not configured', demo: true });
    }
    authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${env().GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/business.manage email profile')}` +
      `&access_type=offline` +
      `&prompt=consent` +
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
    `client_id=${env().FACEBOOK_APP_ID}&client_secret=${env().FACEBOOK_APP_SECRET}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
  );
  if (!tokenRes.ok) throw new Error('Token exchange failed');
  const tokenData: any = await tokenRes.json();
  const shortLivedToken = tokenData.access_token;

  // 2. Extend to long-lived user token
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${env().FACEBOOK_APP_ID}` +
    `&client_secret=${env().FACEBOOK_APP_SECRET}&fb_exchange_token=${shortLivedToken}`,
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
    const resolvedIgId = igId ?? pageId;

    await upsertSocialAccount(businessId, 'instagram_business', {
      account_name: pageName,
      access_token: pageToken,
      page_id: resolvedIgId,
    });

    // Bridge: write tokens to BusinessProfile so InstagramPublisher can read them
    await prisma.businessProfile.updateMany({
      where: { id: businessId },
      data: {
        instagram_access_token: pageToken,
        instagram_page_id: resolvedIgId,
      },
    });
  } else {
    await upsertSocialAccount(businessId, 'facebook_page', {
      account_name: pageName,
      access_token: pageToken,
      page_id: pageId,
    });

    // Bridge: write tokens to BusinessProfile so InstagramPublisher can read them
    await prisma.businessProfile.updateMany({
      where: { id: businessId },
      data: {
        facebook_page_token: pageToken,
        facebook_page_id: pageId,
      },
    });
  }

  return { page_name: pageName, platform };
}

// ── WhatsApp Business callback ────────────────────────────────────────────────
async function handleWhatsAppCallback(code: string, businessId: string) {
  const redirectUri = callbackUrl('whatsapp_business');

  // 1. Exchange code → short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `client_id=${env().FACEBOOK_APP_ID}&client_secret=${env().FACEBOOK_APP_SECRET}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
  );
  if (!tokenRes.ok) throw new Error('Token exchange failed');
  const tokenData: any = await tokenRes.json();
  const shortToken = tokenData.access_token;

  // 2. Extend to long-lived user token
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${env().FACEBOOK_APP_ID}` +
    `&client_secret=${env().FACEBOOK_APP_SECRET}&fb_exchange_token=${shortToken}`,
  );
  const longData: any = longRes.ok ? await longRes.json() : {};
  const userToken = longData.access_token || shortToken;

  // 3. Get WhatsApp Business Account and phone number ID
  let phoneNumberId = '';
  let displayName   = 'WhatsApp Business';

  try {
    const bizRes  = await fetch(`https://graph.facebook.com/v19.0/me/businesses?access_token=${userToken}`);
    const bizData: any = bizRes.ok ? await bizRes.json() : {};
    const firstBiz = (bizData?.data || [])[0];

    if (firstBiz?.id) {
      const wabaRes  = await fetch(
        `https://graph.facebook.com/v19.0/${firstBiz.id}/owned_whatsapp_business_accounts?access_token=${userToken}`,
      );
      const wabaData: any = wabaRes.ok ? await wabaRes.json() : {};
      const firstWaba = (wabaData?.data || [])[0];

      if (firstWaba?.id) {
        const phonesRes  = await fetch(
          `https://graph.facebook.com/v19.0/${firstWaba.id}/phone_numbers?access_token=${userToken}`,
        );
        const phonesData: any = phonesRes.ok ? await phonesRes.json() : {};
        const firstPhone = (phonesData?.data || [])[0];

        if (firstPhone?.id) {
          phoneNumberId = firstPhone.id;
          displayName   = firstPhone.display_phone_number || firstPhone.verified_name || displayName;
        }
      }
    }
  } catch (_) {}

  await upsertSocialAccount(businessId, 'whatsapp_business', {
    account_name: displayName,
    access_token: userToken,
    page_id:      phoneNumberId,
  });

  // Mirror into BusinessProfile so WhatsAppExecutor can read directly
  await prisma.businessProfile.updateMany({
    where: { id: businessId },
    data: {
      whatsapp_access_token:    userToken,
      ...(phoneNumberId ? { whatsapp_phone_number_id: phoneNumberId } : {}),
    },
  });

  return { page_name: displayName, platform: 'whatsapp_business' };
}

// ── Google Business callback ──────────────────────────────────────────────────
async function handleGoogleCallback(code: string, businessId: string) {
  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      redirect_uri:  callbackUrl('google_business'),
      grant_type:    'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error('Google token exchange failed');
  const tokenData: any = await tokenRes.json();
  const accessToken  = tokenData.access_token  || '';
  const refreshToken = tokenData.refresh_token || '';  // long-lived; must be stored
  const expiresIn    = (tokenData.expires_in as number) || 3600;
  const expiresAt    = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Get user info for display name
  const userRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData: any = userRes.ok ? await userRes.json() : {};
  const accountName = userData.name || userData.email || 'Google Account';

  // Try to get first Google Business location's path for the Reviews API
  let locationPath = '';
  try {
    const acctRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (acctRes.ok) {
      const acctData: any = await acctRes.json();
      const firstAccount  = acctData?.accounts?.[0]?.name;
      if (firstAccount) {
        const locRes = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${firstAccount}/locations?pageSize=1&readMask=name,storeCode`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (locRes.ok) {
          const locData: any = await locRes.json();
          const loc = locData?.locations?.[0];
          if (loc?.name) locationPath = loc.name;
        }
      }
    }
  } catch (_) {}

  // Upsert SocialAccount — store access_token, refresh_token, expiry
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform: 'google_business' },
  });
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts
       SET account_name=$1, access_token=$2, page_id=$3, is_connected=true,
           last_sync=$4, refresh_token=$5, expires_at=$6
       WHERE id=$7`,
      accountName, accessToken, locationPath, new Date().toISOString(),
      refreshToken || null, expiresAt, existing.id,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO social_accounts
         (id, created_date, linked_business, platform, account_name, access_token, page_id, is_connected, last_sync, refresh_token, expires_at)
       VALUES (gen_random_uuid()::text, now(), $1, 'google_business', $2, $3, $4, true, $5, $6, $7)`,
      businessId, accountName, accessToken, locationPath,
      new Date().toISOString(), refreshToken || null, expiresAt,
    );
  }

  // Mirror access token into BusinessProfile
  await prisma.businessProfile.updateMany({
    where: { id: businessId },
    data:  { google_access_token: accessToken },
  });

  return { page_name: accountName, platform: 'google_business' };
}

// ── TikTok callback ───────────────────────────────────────────────────────────
async function handleTikTokCallback(code: string, businessId: string) {
  // TikTok Content Posting API v2 token endpoint (new — replaces deprecated open-api.tiktok.com)
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    env().TIKTOK_CLIENT_KEY,
      client_secret: env().TIKTOK_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  callbackUrl('tiktok_business'),
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error('TikTok token exchange failed');
  const tokenData: any = await tokenRes.json();
  const access_token  = tokenData?.access_token  || tokenData?.data?.access_token  || '';
  const refresh_token = tokenData?.refresh_token || tokenData?.data?.refresh_token || '';
  const open_id       = tokenData?.open_id       || tokenData?.data?.open_id       || '';
  const expiresIn     = tokenData?.expires_in    || tokenData?.data?.expires_in    || 86400;
  const expiresAt     = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Fetch display name from user info
  let display_name = 'TikTok Account';
  try {
    const infoRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (infoRes.ok) {
      const info: any = await infoRes.json();
      display_name = info?.data?.user?.display_name || display_name;
    }
  } catch (_) {}

  // Upsert SocialAccount with refresh_token + expiry
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform: 'tiktok_business' },
  });
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts
       SET account_name=$1, access_token=$2, page_id=$3, is_connected=true,
           last_sync=$4, refresh_token=$5, expires_at=$6
       WHERE id=$7`,
      display_name, access_token, open_id, new Date().toISOString(),
      refresh_token || null, expiresAt, existing.id,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO social_accounts
         (id, created_date, linked_business, platform, account_name, access_token, page_id, is_connected, last_sync, refresh_token, expires_at)
       VALUES (gen_random_uuid()::text, now(), $1, 'tiktok_business', $2, $3, $4, true, $5, $6, $7)`,
      businessId, display_name, access_token, open_id,
      new Date().toISOString(), refresh_token || null, expiresAt,
    );
  }

  return { platform: 'tiktok_business', page_name: display_name };
}

// ── Callback route ────────────────────────────────────────────────────────────
router.get('/callback/:platform', async (req: Request, res: Response) => {
  const { platform }             = req.params;
  const { code, state, error }   = req.query as Record<string, string>;

  if (error) {
    return res.redirect(`${env().FRONTEND_URL}/integrations?oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${env().FRONTEND_URL}/integrations?oauth_error=missing_params`);
  }

  const stateData = await consumeState(state);
  if (!stateData) {
    return res.redirect(`${env().FRONTEND_URL}/integrations?oauth_error=invalid_state`);
  }

  try {
    let result: any;
    if (platform === 'facebook_page' || platform === 'instagram_business') {
      result = await handleFacebookCallback(code, platform, stateData.businessId);
    } else if (platform === 'whatsapp_business') {
      result = await handleWhatsAppCallback(code, stateData.businessId);
    } else if (platform === 'google_business') {
      result = await handleGoogleCallback(code, stateData.businessId);
    } else if (platform === 'tiktok_business') {
      result = await handleTikTokCallback(code, stateData.businessId);
    } else {
      return res.redirect(`${env().FRONTEND_URL}/integrations?oauth_error=unknown_platform`);
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

    // Clear corresponding BusinessProfile fields
    const bpClear: Record<string, null> = {};
    if (platform === 'instagram_business') {
      bpClear['instagram_access_token'] = null;
      bpClear['instagram_page_id'] = null;
    } else if (platform === 'facebook_page') {
      bpClear['facebook_page_token'] = null;
      bpClear['facebook_page_id'] = null;
    } else if (platform === 'whatsapp_business') {
      bpClear['whatsapp_access_token'] = null;
      bpClear['whatsapp_phone_number_id'] = null;
    } else if (platform === 'google_business') {
      bpClear['google_access_token'] = null;
    }
    if (Object.keys(bpClear).length > 0) {
      await prisma.businessProfile.updateMany({ where: { id: businessId }, data: bpClear });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
