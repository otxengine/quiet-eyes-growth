/**
 * googleTokenRefresh — refreshes expired Google OAuth access tokens.
 *
 * Google access tokens expire after 1 hour.
 * We store the refresh_token in social_accounts.refresh_token and use it
 * to get a new access_token automatically before any Google API call.
 */
import { prisma } from '../db';
import { createLogger } from '../infra/logger';
import { tryEncryptToken, tryDecryptToken } from './crypto';

const logger = createLogger('GoogleTokenRefresh');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Refresh the Google access token for a business.
 * Updates both social_accounts.access_token and BusinessProfile.google_access_token.
 * Returns the new access token, or null if refresh is not possible.
 */
export async function refreshGoogleToken(businessProfileId: string): Promise<string | null> {
  const clientId     = process.env.GOOGLE_CLIENT_ID     || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;

  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
  });
  if (!account) return null;

  const refreshToken = (account as any).refresh_token as string | null;
  if (!refreshToken) return null;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      logger.warn(`Google token refresh failed for ${businessProfileId}: ${err?.error_description || res.status}`);
      return null;
    }

    const data: any = await res.json();
    const newToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Update SocialAccount
    await prisma.$executeRawUnsafe(
      `UPDATE social_accounts SET access_token=$1, expires_at=$2, last_sync=$3 WHERE id=$4`,
      tryEncryptToken(newToken), expiresAt, new Date().toISOString(), account.id,
    );

    // Mirror to BusinessProfile
    await prisma.businessProfile.updateMany({
      where: { id: businessProfileId },
      data:  { google_access_token: newToken },
    });

    logger.info(`Google token refreshed for business ${businessProfileId}`);
    return newToken;
  } catch (err: any) {
    logger.warn(`Google token refresh error for ${businessProfileId}: ${err.message}`);
    return null;
  }
}

/**
 * Get a valid Google access token — refreshes automatically if the stored
 * token expires within the next 5 minutes.
 */
export async function getValidGoogleToken(businessProfileId: string): Promise<string | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { linked_business: businessProfileId, platform: 'google_business', is_connected: true },
  });
  if (!account?.access_token) return null;

  const expiresAt = (account as any).expires_at as string | null;
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // If no expiry stored or expires in less than 5 min → refresh
  if (!expiresAt || expiresAt < fiveMinFromNow) {
    const refreshed = await refreshGoogleToken(businessProfileId);
    return refreshed || account.access_token; // fall back to existing token if refresh fails
  }

  return tryDecryptToken(account.access_token);
}

/**
 * Scan all businesses with Google connected and refresh tokens expiring within 10 minutes.
 * Called by the scheduler every 30 minutes.
 */
export async function refreshExpiringGoogleTokens(): Promise<void> {
  try {
    const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    // Use raw query — expires_at column added via startup SQL, not in Prisma schema yet
    const rows = await prisma.$queryRawUnsafe<Array<{ linked_business: string }>>(
      `SELECT linked_business FROM social_accounts
       WHERE platform='google_business' AND is_connected=true
       AND refresh_token IS NOT NULL
       AND (expires_at IS NULL OR expires_at < $1)`,
      tenMinFromNow,
    );
    for (const row of rows) {
      if (row.linked_business) {
        await refreshGoogleToken(row.linked_business).catch(() => {});
      }
    }
    if (rows.length > 0) {
      logger.info(`[scheduler] Refreshed Google tokens for ${rows.length} businesses`);
    }
  } catch (err: any) {
    logger.warn(`refreshExpiringGoogleTokens error: ${err.message}`);
  }
}
