/**
 * OAuth 2.0 router — /api/oauth
 *
 * Endpoints:
 *   GET  /api/oauth/initiate/:platform?businessId=...  — signed in; state is bound to the user + business
 *   GET  /api/oauth/callback/:platform                 — provider redirect → the app's /oauth/callback page
 *   POST /api/oauth/complete                           — signed in; the same user exchanges the code
 *   POST /api/oauth/confirm-page                       — signed in; saves the page / location picked
 *   POST /api/oauth/disconnect
 *
 * Supported platforms: facebook_page | instagram_business | google_business
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
import { tryEncryptToken } from '../lib/crypto';
import { getUserBusinessIds } from '../lib/ownership';
import { disconnectIntegrations } from '../lib/revokeTokens';
import { frontendOrigins, getUserId } from '../middleware/auth';
import { requireOwnsBusiness } from '../middleware/businessAccess';

const router = Router();

// Temporary in-memory store for page picker sessions (TTL 10 min); userId: who may confirm
const pagePickerSessions = new Map<string, { businessId: string; platform: string; pages: any[]; expires: number; userId?: string }>();
function createPickerSession(businessId: string, platform: string, pages: any[]): string {
  const key = randomBytes(16).toString('hex');
  pagePickerSessions.set(key, { businessId, platform, pages, expires: Date.now() + 10 * 60 * 1000 });
  return key;
}
function getPickerSession(key: string) {
  const s = pagePickerSessions.get(key);
  if (!s || s.expires < Date.now()) { pagePickerSessions.delete(key); return null; }
  return s;
}

// ── Env — read lazily so dotenv has time to load ─────────────────────────────
// FACEBOOK_APP_ID and META_APP_ID are the same Meta app — support both names.
const env = () => {
  const fbId     = process.env.FACEBOOK_APP_ID     || process.env.META_APP_ID      || '';
  const fbSecret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET  || '';
  return {
    FACEBOOK_APP_ID:      fbId,
    FACEBOOK_APP_SECRET:  fbSecret,
    GOOGLE_CLIENT_ID:           process.env.GOOGLE_CLIENT_ID           || '',
    GOOGLE_CLIENT_SECRET:       process.env.GOOGLE_CLIENT_SECRET       || '',
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    FRONTEND_URL:               process.env.FRONTEND_URL               || 'http://localhost:5173',
    SERVER_BASE_URL:            process.env.SERVER_BASE_URL            || 'http://localhost:3007',
  };
};

// ── DB-backed state store — survives restarts and multi-instance deployments ──
// Table: oauth_state_store (id TEXT PK, business_id TEXT, platform TEXT, user_id TEXT, expires_at TIMESTAMPTZ)
// Created at server startup (see index.ts).

// 128-bit, 10-minute state bound to the signed-in user who asked for it and to the business they own.
export async function generateState(platform: string, businessId: string, userId: string, codeVerifier?: string): Promise<string> {
  const state     = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO oauth_state_store (id, business_id, platform, user_id, expires_at, code_verifier)
     VALUES ($1,$2,$3,$4,$5::timestamptz,$6)`,
    state, businessId, platform, userId, expiresAt, codeVerifier ?? null,
  );
  return state;
}

// Single use, unexpired, same platform, and only for the user who started the flow, who must still
// own the business. To anyone else the state is useless.
export async function consumeState(state: string, userId: string, platform: string): Promise<{ businessId: string; codeVerifier?: string } | null> {
  const rows = await prisma.$queryRawUnsafe(
    `DELETE FROM oauth_state_store WHERE id=$1 AND user_id=$2 AND platform=$3 AND expires_at > NOW()
     RETURNING business_id, code_verifier`,
    state, userId, platform,
  ) as Array<{ business_id: string; code_verifier?: string | null }>;
  const row = rows[0];
  if (!row || !(await getUserBusinessIds(userId)).includes(row.business_id)) return null;
  return { businessId: row.business_id, codeVerifier: row.code_verifier ?? undefined };
}

function callbackUrl(platform: string): string {
  return `${env().SERVER_BASE_URL}/api/oauth/callback/${platform}`;
}

// Upsert a SocialAccount record (no unique index on linked_business+platform, so findFirst+update/create)
export async function upsertSocialAccount(
  businessId: string,
  platform: string,
  data: { account_name: string; access_token: string; page_id?: string },
) {
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform },
  });
  const encData = { ...data, access_token: tryEncryptToken(data.access_token) };
  if (existing) {
    await prisma.socialAccount.update({
      where: { id: existing.id },
      data: { ...encData, is_connected: true, last_sync: new Date().toISOString() },
    });
  } else {
    await prisma.socialAccount.create({
      data: {
        linked_business: businessId,
        platform,
        ...encData,
        is_connected: true,
        last_sync: new Date().toISOString(),
      },
    });
  }
}

// ── Initiate OAuth ────────────────────────────────────────────────────────────
router.get('/initiate/:platform', requireOwnsBusiness(req => req.query.businessId as string | undefined), async (req: Request, res: Response) => {
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

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' }); // the admin key has no user to bind the flow to
  let state: string;
  try {
    state = await generateState(String(platform), String(businessId), userId);
  } catch (err: any) {
    console.error('[oauth/initiate] state insert failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  let authUrl: string;

  if (platform === 'facebook_page' || platform === 'instagram_business') {
    if (!env().FACEBOOK_APP_ID) {
      return res.status(503).json({ error: 'Facebook app not configured', demo: true });
    }

    // pages_manage_posts is required for Facebook feed/photos
    // instagram_manage_comments / pages_manage_engagement dropped — no reply/moderate feature
    // uses them yet (only read-only comment analysis exists); re-add once that ships.
    const scope = platform === 'instagram_business'
      ? 'pages_show_list,pages_read_engagement,instagram_content_publish,instagram_basic'
      : 'pages_show_list,pages_read_engagement,pages_manage_posts';

    authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${env().FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}` +
      `&response_type=code`;

  } else if (platform === 'google_business') {
    if (!env().GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google app not configured', demo: true });
    }
    authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${env().GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&response_type=code` +
      // Only the scope we use — Google's verification reviews every requested scope
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/business.manage')}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${state}`;

  } else if (platform === 'google_ads') {
    if (!env().GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google app not configured', demo: true });
    }
    authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${env().GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/adwords email profile')}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${state}`;

  } else if (platform === 'meta_ads') {
    if (!env().FACEBOOK_APP_ID) {
      return res.status(503).json({ error: 'Meta app not configured', demo: true });
    }
    authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${env().FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl(platform))}` +
      `&scope=${encodeURIComponent('ads_management,ads_read,business_management,pages_show_list')}` +
      `&state=${state}` +
      `&response_type=code`;

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
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
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

  console.log(`[oauth/facebook] found ${pages.length} page(s):`, pages.map((p: any) => `${p.name} (${p.id})`));

  // If multiple pages → store in session and return picker flag
  if (pages.length > 1) {
    const sessionKey = createPickerSession(businessId, platform,
      pages.map((p: any) => ({ id: p.id, name: p.name, access_token: p.access_token })));
    return { needs_page_selection: true, platform, sessionKey };
  }

  // Single page — save automatically
  return await saveFacebookPage(businessId, platform, pages[0]);
}

async function saveFacebookPage(businessId: string, platform: string, page: any) {
  const pageToken = page.access_token;
  const pageId    = page.id;
  const pageName  = page.name;

  // For Instagram: get linked Instagram Business Account ID and store separately
  if (platform === 'instagram_business') {
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`,
    );
    const igData: any = igRes.ok ? await igRes.json() : {};
    const igId = igData?.instagram_business_account?.id ?? null;

    console.log(`[oauth/instagram] page "${pageName}" (${pageId}) → ig_business_account:`, igId ?? 'NOT FOUND');

    if (!igId) {
      // The Facebook Page doesn't have a linked Instagram Business/Creator account.
      // Storing the Facebook Page ID would cause silent failures at publish time.
      throw new Error(
        `הדף "${pageName}" לא מחובר לחשבון Instagram עסקי. ` +
        `כדי לחבר: עבור להגדרות דף Facebook → Instagram → "Connect account". ` +
        `ודא שחשבון ה-Instagram שלך מוגדר כ-Business או Creator.`
      );
    }

    await upsertSocialAccount(businessId, 'instagram_business', {
      account_name: pageName,
      access_token: pageToken,
      page_id: igId,
    });

    await prisma.businessProfile.updateMany({
      where: { id: businessId },
      data: {
        instagram_access_token: tryEncryptToken(pageToken),
        instagram_page_id: igId,
      },
    });
  } else {
    await upsertSocialAccount(businessId, 'facebook_page', {
      account_name: pageName,
      access_token: pageToken,
      page_id: pageId,
    });

    await prisma.businessProfile.updateMany({
      where: { id: businessId },
      data: {
        facebook_page_token: tryEncryptToken(pageToken),
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
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
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
export interface GbpLocation {
  id: string;        // v4 "accounts/X/locations/Y" — the Reviews API needs the account prefix v1 omits
  name: string;      // listing title
  detail: string;    // address, to tell branches apart in the picker
  placeId?: string;
}

/** Every location the signed-in Google user manages. Throws when the API fails or there are none, so the connect fails visibly. */
// ponytail: first 100 locations per account — paginate if an owner ever has more
export async function listGbpLocations(accessToken: string): Promise<GbpLocation[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const acctRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers });
  if (!acctRes.ok) {
    console.error(`[oauth/google_business] accounts.list ${acctRes.status}:`, (await acctRes.text().catch(() => '')).slice(0, 500));
    throw new Error(`Google Business Profile החזיר שגיאה (${acctRes.status}). נסה שוב מאוחר יותר.`);
  }
  const accounts: any[] = ((await acctRes.json()) as any)?.accounts || [];
  const locations: GbpLocation[] = [];
  for (const acct of accounts) {
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?pageSize=100&readMask=name,title,storefrontAddress,metadata`,
      { headers },
    );
    if (!locRes.ok) {
      console.error(`[oauth/google_business] locations.list ${locRes.status} for ${acct.name}`);
      continue;
    }
    for (const loc of (((await locRes.json()) as any)?.locations || [])) {
      const addr = loc.storefrontAddress;
      locations.push({
        id: `${acct.name}/${loc.name}`,
        name: loc.title || loc.name,
        detail: [...(addr?.addressLines || []), addr?.locality].filter(Boolean).join(', '),
        placeId: loc.metadata?.placeId,
      });
    }
  }
  if (!locations.length) {
    throw new Error('לא נמצא עסק ב-Google Business Profile בחשבון הזה. ודא שאתה מחובר עם החשבון שמנהל את העסק ונסה שוב.');
  }
  return locations;
}

/** The listing whose Maps place matches this business needs no question; neither does a lone listing. Otherwise the owner picks. */
export function pickGbpLocation(locations: GbpLocation[], placeId?: string | null): GbpLocation | undefined {
  return locations.find(l => placeId && l.placeId === placeId) || (locations.length === 1 ? locations[0] : undefined);
}

type GoogleTokens = { accessToken: string; refreshToken: string; expiresAt: string };

async function saveGoogleLocation(businessId: string, t: GoogleTokens, loc: GbpLocation) {
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform: 'google_business' },
  });
  const encAccessToken  = tryEncryptToken(t.accessToken);
  const encRefreshToken = t.refreshToken ? tryEncryptToken(t.refreshToken) : null;
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts
       SET account_name=$1, access_token=$2, page_id=$3, is_connected=true,
           last_sync=$4, refresh_token=$5, expires_at=$6, last_error=NULL
       WHERE id=$7`,
      loc.name, encAccessToken, loc.id, new Date().toISOString(),
      encRefreshToken, t.expiresAt, existing.id,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO social_accounts
         (id, created_date, linked_business, platform, account_name, access_token, page_id, is_connected, last_sync, refresh_token, expires_at)
       VALUES (gen_random_uuid()::text, now(), $1, 'google_business', $2, $3, $4, true, $5, $6, $7)`,
      businessId, loc.name, encAccessToken, loc.id,
      new Date().toISOString(), encRefreshToken, t.expiresAt,
    );
  }

  // Mirror access token into BusinessProfile — encrypted, same as the SocialAccount copy
  await prisma.businessProfile.updateMany({
    where: { id: businessId },
    data:  { google_access_token: encAccessToken },
  });

  return { page_name: loc.name, platform: 'google_business' };
}

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
  const tokens: GoogleTokens = { accessToken, refreshToken, expiresAt };

  const locations = await listGbpLocations(accessToken);
  const bp = await prisma.businessProfile.findUnique({
    where: { id: businessId }, select: { google_place_id: true },
  });
  const match = pickGbpLocation(locations, bp?.google_place_id);
  if (match) return await saveGoogleLocation(businessId, tokens, match);

  const sessionKey = createPickerSession(businessId, 'google_business', locations.map(l => ({ ...l, tokens })));
  return { needs_page_selection: true, platform: 'google_business', sessionKey };
}

// ── Meta Ads callback ─────────────────────────────────────────────────────────
async function handleMetaAdsCallback(code: string, businessId: string) {
  const redirectUri = callbackUrl('meta_ads');

  // 1. Exchange code → short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `client_id=${env().FACEBOOK_APP_ID}&client_secret=${env().FACEBOOK_APP_SECRET}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
  );
  if (!tokenRes.ok) throw new Error('Meta Ads token exchange failed');
  const tokenData: any = await tokenRes.json();
  const shortLivedToken = tokenData.access_token;

  // 2. Extend to long-lived user token (~60 days)
  const longRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${env().FACEBOOK_APP_ID}` +
    `&client_secret=${env().FACEBOOK_APP_SECRET}&fb_exchange_token=${shortLivedToken}`,
  );
  const longData: any = longRes.ok ? await longRes.json() : {};
  const userToken = longData.access_token || shortLivedToken;

  // 3. Fetch ad accounts for this user
  const adAccountsRes = await fetch(
    `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status,currency&limit=20&access_token=${userToken}`,
  );
  if (!adAccountsRes.ok) throw new Error('Failed to fetch Meta Ad Accounts');
  const adAccountsData: any = await adAccountsRes.json();
  const adAccounts: any[] = adAccountsData?.data || [];

  if (adAccounts.length === 0) {
    throw new Error(
      'לא נמצאו חשבונות פרסום Meta. צור חשבון Ad Account ב-business.facebook.com ונסה שוב.',
    );
  }

  // Prefer first active account (account_status === 1), fall back to first in list
  const activeAccount = adAccounts.find((a: any) => a.account_status === 1) || adAccounts[0];
  return await saveMetaAdsAccount(businessId, activeAccount, userToken);
}

async function saveMetaAdsAccount(businessId: string, account: any, userToken: string) {
  const adAccountId = account.id;
  const accountName = account.name || 'Meta Ads Account';
  const currency    = account.currency || 'ILS';

  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform: 'meta_ads' },
  });
  const encUserToken = tryEncryptToken(userToken);
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts
       SET account_name=$1, access_token=$2, page_id=$3, is_connected=true, last_sync=$4
       WHERE id=$5`,
      `${accountName} (${currency})`, encUserToken, adAccountId, new Date().toISOString(), existing.id,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO social_accounts
         (id, created_date, linked_business, platform, account_name, access_token, page_id, is_connected, last_sync)
       VALUES (gen_random_uuid()::text, now(), $1, 'meta_ads', $2, $3, $4, true, $5)`,
      businessId, `${accountName} (${currency})`, encUserToken, adAccountId, new Date().toISOString(),
    );
  }

  console.log(`[meta_ads] Connected: business=${businessId} ad_account=${adAccountId} currency=${currency}`);
  return { page_name: `${accountName} (${adAccountId})`, platform: 'meta_ads' };
}

// ── Google Ads callback ───────────────────────────────────────────────────────
async function handleGoogleAdsCallback(code: string, businessId: string) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      redirect_uri:  callbackUrl('google_ads'),
      grant_type:    'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error('Google Ads token exchange failed');
  const tokenData: any = await tokenRes.json();
  const accessToken  = tokenData.access_token  || '';
  const refreshToken = tokenData.refresh_token || '';
  const expiresIn    = (tokenData.expires_in as number) || 3600;
  const expiresAt    = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Get user's Google account name
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData: any = userRes.ok ? await userRes.json() : {};
  const accountName = userData.name || userData.email || 'Google Ads Account';

  // Fetch list of accessible Google Ads customer IDs
  const developerToken = env().GOOGLE_ADS_DEVELOPER_TOKEN;
  let customerId = '';
  try {
    const customersRes = await fetch('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
    });
    if (customersRes.ok) {
      const customersData: any = await customersRes.json();
      // resourceNames format: ["customers/1234567890", ...]
      const resourceNames: string[] = customersData.resourceNames || [];
      customerId = resourceNames[0]?.replace('customers/', '') || '';
    } else {
      const errBody: any = await customersRes.json().catch(() => ({}));
      console.warn('[google_ads] listAccessibleCustomers failed:', errBody?.error?.message || customersRes.status);
    }
  } catch (e: any) {
    console.warn('[google_ads] listAccessibleCustomers error:', e.message);
  }

  // Upsert SocialAccount — page_id stores the customer_id
  const existing = await prisma.socialAccount.findFirst({
    where: { linked_business: businessId, platform: 'google_ads' },
  });
  const encGAdsToken        = tryEncryptToken(accessToken);
  const encGAdsRefreshToken = refreshToken ? tryEncryptToken(refreshToken) : null;
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts
       SET account_name=$1, access_token=$2, page_id=$3, is_connected=true,
           last_sync=$4, refresh_token=$5, expires_at=$6
       WHERE id=$7`,
      accountName, encGAdsToken, customerId, new Date().toISOString(),
      encGAdsRefreshToken, expiresAt, existing.id,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO social_accounts
         (id, created_date, linked_business, platform, account_name, access_token, page_id, is_connected, last_sync, refresh_token, expires_at)
       VALUES (gen_random_uuid()::text, now(), $1, 'google_ads', $2, $3, $4, true, $5, $6, $7)`,
      businessId, accountName, encGAdsToken, customerId,
      new Date().toISOString(), encGAdsRefreshToken, expiresAt,
    );
  }

  const displayName = customerId ? `${accountName} (${customerId})` : accountName;
  console.log(`[google_ads] Connected: business=${businessId} customer=${customerId || 'unknown'}`);
  return { page_name: displayName, platform: 'google_ads' };
}

// ── Callback route ────────────────────────────────────────────────────────────
// Nothing is exchanged here: this redirect carries no proof of who is signed in. The popup goes on
// to the app's /oauth/callback page (our frontend origin, same browser, signed in), which finishes
// with an authenticated POST /complete, so only the browser and user that started the flow can
// finish it. The code rides in the fragment, which never reaches a server. (Meta's pages cut
// window.opener, so the popup can't hand anything back to the window that opened it.)
router.get('/callback/:platform', (req: Request, res: Response) => {
  const { platform } = req.params;
  const { code, state, error } = req.query as Record<string, string>;
  const ok = !error && typeof code === 'string' && typeof state === 'string' && !!code && !!state;
  const params = ok ? { platform, code, state } : { error: typeof error === 'string' && error ? error : 'missing_params' };
  return res.redirect(`${frontendOrigins()[0]}/oauth/callback#${new URLSearchParams(params)}`);
});

// ── Complete — the signed-in user who started the flow exchanges the code ─────
router.post('/complete', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { platform, code, state } = req.body ?? {};
  if (typeof platform !== 'string' || typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).json({ error: 'Missing params' });
  }

  let stateData: Awaited<ReturnType<typeof consumeState>>;
  try {
    stateData = await consumeState(state, userId, platform);
  } catch (err: any) {
    console.error('[oauth/complete] state lookup failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  if (!stateData) return res.status(400).json({ error: 'invalid_state' });

  try {
    let result: any;
    if (platform === 'facebook_page' || platform === 'instagram_business') {
      result = await handleFacebookCallback(code, platform, stateData.businessId);
    } else if (platform === 'whatsapp_business') {
      result = await handleWhatsAppCallback(code, stateData.businessId);
    } else if (platform === 'google_business') {
      result = await handleGoogleCallback(code, stateData.businessId);
    } else if (platform === 'google_ads') {
      result = await handleGoogleAdsCallback(code, stateData.businessId);
    } else if (platform === 'meta_ads') {
      result = await handleMetaAdsCallback(code, stateData.businessId);
    } else {
      return res.status(400).json({ error: 'unknown_platform' });
    }

    // Several pages / locations: the app shows a picker, then calls POST /confirm-page. Names only, no tokens.
    if (result.needs_page_selection) {
      const s = getPickerSession(result.sessionKey)!;
      s.userId = userId;
      const isGoogle = result.platform === 'google_business';
      return res.json({
        needs_page_selection: true, platform: result.platform, session: result.sessionKey,
        pages: s.pages.map((p: any) => ({ name: p.name, detail: isGoogle ? p.detail : `ID: ${p.id}` })),
      });
    }
    return res.json({ ok: true, platform: result.platform, page_name: result.page_name });
  } catch (err: any) {
    console.error(`[oauth/${platform}] complete error:`, err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ── Disconnect ────────────────────────────────────────────────────────────────
// Revokes the token with Google / Meta, then deletes every stored copy (lib/revokeTokens.ts).
router.post('/disconnect', requireOwnsBusiness(req => req.body?.businessId), async (req: Request, res: Response) => {
  const { businessId, platform } = req.body;
  if (typeof businessId !== 'string' || typeof platform !== 'string' || !businessId || !platform) {
    return res.status(400).json({ error: 'Missing params' });
  }

  try {
    await disconnectIntegrations([businessId], platform);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Confirm page selection — the same signed-in user who ran /complete ───────
router.post('/confirm-page', async (req: Request, res: Response) => {
  const { session, idx } = req.body ?? {};
  const s = typeof session === 'string' ? getPickerSession(session) : null;
  if (!s || !s.userId || s.userId !== getUserId(req)) {
    return res.status(400).json({ error: 'החיבור פג תוקף — נסה לחבר שוב.' });
  }

  const page = s.pages[Number(idx)];
  if (!page) {
    return res.status(400).json({ error: 'Invalid selection' });
  }

  try {
    // meta_ads uses saveMetaAdsAccount; Google uses saveGoogleLocation; Facebook/Instagram use saveFacebookPage
    const result = s.platform === 'meta_ads'
      ? await saveMetaAdsAccount(s.businessId, page, page.access_token)
      : s.platform === 'google_business'
        ? await saveGoogleLocation(s.businessId, page.tokens, page)
        : await saveFacebookPage(s.businessId, s.platform, page);
    pagePickerSessions.delete(session);
    return res.json({ ok: true, platform: s.platform, page_name: result.page_name });
  } catch (err: any) {
    console.error('[oauth/confirm-page]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

export default router;
