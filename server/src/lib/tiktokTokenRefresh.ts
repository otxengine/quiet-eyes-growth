/**
 * tiktokTokenRefresh — refreshes expired TikTok OAuth access tokens.
 *
 * TikTok access tokens expire after 24 hours.
 * We store the refresh_token in social_accounts.refresh_token and use it
 * to get a new access_token automatically before any TikTok API call.
 *
 * NOTE: TikTok rotates refresh tokens on every refresh — we must store the
 * new refresh_token returned in the response or future refreshes will fail.
 */
import { prisma } from '../db';
import { createLogger } from '../infra/logger';
import { tryEncryptToken, tryDecryptToken } from './crypto';

const logger = createLogger('TikTokTokenRefresh');

const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

/**
 * Refresh the TikTok access token for a business.
 * Updates social_accounts.access_token, refresh_token, and expires_at.
 * Returns the new access token, or null if refresh is not possible.
 */
export async function refreshTikTokToken(businessProfileId: string): Promise<string | null> {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY    || '';
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
  if (!clientKey || !clientSecret) return null;

  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'tiktok_business', is_connected: true },
  });
  if (!account) return null;

  const refreshToken = (account as any).refresh_token as string | null;
  if (!refreshToken) return null;

  try {
    const res = await fetch(TIKTOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key:    clientKey,
        client_secret: clientSecret,
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      logger.warn(`TikTok token refresh failed for ${businessProfileId}: ${err?.error?.message || res.status}`);
      return null;
    }

    const data: any = await res.json();
    const newToken        = (data.access_token  || data?.data?.access_token)  as string;
    const newRefreshToken = (data.refresh_token || data?.data?.refresh_token) as string | undefined;
    const expiresIn       = (data.expires_in    || data?.data?.expires_in    || 86400) as number;
    const expiresAt       = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (!newToken) {
      logger.warn(`TikTok token refresh returned no access_token for ${businessProfileId}`);
      return null;
    }

    // TikTok rotates refresh tokens — store the new one if provided
    if (newRefreshToken) {
      await prisma.$executeRawUnsafe(
        `UPDATE social_accounts SET access_token=$1, expires_at=$2, last_sync=$3, refresh_token=$4 WHERE id=$5`,
        tryEncryptToken(newToken), expiresAt, new Date().toISOString(), newRefreshToken, account.id,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE social_accounts SET access_token=$1, expires_at=$2, last_sync=$3 WHERE id=$4`,
        tryEncryptToken(newToken), expiresAt, new Date().toISOString(), account.id,
      );
    }

    logger.info(`TikTok token refreshed for business ${businessProfileId}`);
    return newToken;
  } catch (err: any) {
    logger.warn(`TikTok token refresh error for ${businessProfileId}: ${err.message}`);
    return null;
  }
}

/**
 * Get a valid TikTok access token — refreshes automatically if the stored
 * token expires within the next 30 minutes.
 */
export async function getValidTikTokToken(businessProfileId: string): Promise<string | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'tiktok_business', is_connected: true },
  });
  if (!account?.access_token) return null;

  const expiresAt      = (account as any).expires_at as string | null;
  const thirtyMinFromNow = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // If no expiry stored or expires within 30 min → refresh
  if (!expiresAt || expiresAt < thirtyMinFromNow) {
    const refreshed = await refreshTikTokToken(businessProfileId);
    if (!refreshed) logger.warn(`TikTok token expired and refresh failed for ${businessProfileId} — using existing token`);
    return refreshed || account.access_token;
  }

  return tryDecryptToken(account.access_token);
}

/**
 * Scan all businesses with TikTok connected and refresh tokens expiring within 1 hour.
 * Called by the scheduler every 6 hours (TikTok tokens live 24h).
 */
export async function refreshExpiringTikTokTokens(): Promise<void> {
  try {
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rows = await prisma.$queryRawUnsafe<Array<{ linked_business: string }>>(
      `SELECT linked_business FROM social_accounts
       WHERE platform='tiktok_business' AND is_connected=true
       AND refresh_token IS NOT NULL
       AND (expires_at IS NULL OR expires_at < $1)`,
      oneHourFromNow,
    );
    for (const row of rows) {
      if (row.linked_business) {
        await refreshTikTokToken(row.linked_business).catch(() => {});
      }
    }
    if (rows.length > 0) {
      logger.info(`[scheduler] Refreshed TikTok tokens for ${rows.length} businesses`);
    }
  } catch (err: any) {
    logger.warn(`refreshExpiringTikTokTokens error: ${err.message}`);
  }
}