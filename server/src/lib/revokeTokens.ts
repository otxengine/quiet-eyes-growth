/**
 * Disconnecting an integration, or deleting the account that owns it: revoke each token with the
 * provider, then wipe our copies (SocialAccount, the BusinessProfile mirror fields, MetaConnection).
 * Revocation is best-effort, so a provider outage never leaves a token in our DB.
 */
import { prisma } from '../db';
import { tryDecryptToken } from './crypto';

const GRAPH = 'https://graph.facebook.com/v19.0';
const GOOGLE_PLATFORMS = new Set(['google_business', 'google_ads']);

// Meta permissions that only this integration asks for. Shared ones (pages_show_list,
// pages_read_engagement, business_management) stay granted, so the business's other Meta
// integrations keep working. Google has no per-scope revoke: revoking ends the whole grant.
const META_PERMISSIONS: Record<string, string[]> = {
  facebook_page:      ['pages_manage_posts'],
  instagram_business: ['instagram_content_publish', 'instagram_basic'],
  meta_ads:           ['ads_management', 'ads_read'],
  whatsapp_business:  ['whatsapp_business_management', 'whatsapp_business_messaging'],
  messenger:          ['pages_messaging'],
};

// BusinessProfile fields that mirror an integration's token (executors read them directly).
const PROFILE_FIELDS: Record<string, string[]> = {
  instagram_business: ['instagram_access_token', 'instagram_page_id'],
  facebook_page:      ['facebook_page_token', 'facebook_page_id'],
  whatsapp_business:  ['whatsapp_access_token', 'whatsapp_phone_number_id'],
  google_business:    ['google_access_token'],
};

/** MetaConnection.platform → the integration name used everywhere else. */
export const metaIntegration = (connectionPlatform: string) =>
  connectionPlatform === 'whatsapp' ? 'whatsapp_business' : 'messenger';

async function revokeMeta(token: string, permissions: string[]) {
  const appId     = process.env.FACEBOOK_APP_ID     || process.env.META_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Meta app not configured');
  const appToken = encodeURIComponent(`${appId}|${appSecret}`);
  // A page token can't act for its user, so find who granted it and revoke as the app.
  const debug: any = await (await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appToken}`)).json();
  const userId = debug?.data?.user_id;
  if (!userId) throw new Error('debug_token returned no user');
  for (const permission of permissions) {
    const res = await fetch(`${GRAPH}/${userId}/permissions/${permission}?access_token=${appToken}`, { method: 'DELETE' });
    if (!res.ok) console.warn(`[revokeTokens] Meta revoke of ${permission} returned ${res.status}`);
  }
}

/** Revokes a stored (encrypted or legacy plaintext) token with its provider. Never throws. */
export async function revokeToken(platform: string, stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  const token = tryDecryptToken(stored);
  try {
    if (GOOGLE_PLATFORMS.has(platform)) {
      const res = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
      if (!res.ok) console.warn(`[revokeTokens] Google revoke returned ${res.status}`);
    } else if (META_PERMISSIONS[platform]) {
      await revokeMeta(token, META_PERMISSIONS[platform]);
    }
  } catch (e: any) {
    console.warn(`[revokeTokens] ${platform} revoke failed:`, e.message);
  }
}

/** Revokes and deletes the stored tokens of these businesses: one integration, or all of them. */
export async function disconnectIntegrations(businessIds: string[], platform?: string): Promise<void> {
  if (!businessIds.length) return;
  const accountWhere = { linked_business: { in: businessIds }, ...(platform && { platform }) };
  // WhatsApp's token also lives in its MetaConnection; Messenger has only a MetaConnection.
  const connectionWhere = !platform ? { business_profile_id: { in: businessIds } }
    : platform === 'whatsapp_business' ? { business_profile_id: { in: businessIds }, platform: 'whatsapp' }
    : null;

  const accounts = await prisma.socialAccount.findMany({
    where: accountWhere, select: { platform: true, access_token: true, refresh_token: true },
  });
  const connections = connectionWhere
    ? await prisma.metaConnection.findMany({ where: connectionWhere, select: { platform: true, encrypted_token: true } })
    : [];

  // One revoke per token: the WhatsApp token sits in both tables.
  const tokens = new Map<string, string>();
  for (const a of accounts) {
    const stored = a.refresh_token || a.access_token; // Google: revoking the refresh token ends the grant
    if (stored) tokens.set(tryDecryptToken(stored), a.platform);
  }
  for (const c of connections) if (c.encrypted_token) tokens.set(tryDecryptToken(c.encrypted_token), metaIntegration(c.platform));
  await Promise.all([...tokens].map(([token, p]) => revokeToken(p, token)));

  await prisma.socialAccount.updateMany({
    where: accountWhere,
    data: { is_connected: false, access_token: null, refresh_token: null, last_error: null },
  });
  if (connectionWhere) {
    await prisma.metaConnection.updateMany({ where: connectionWhere, data: { is_active: false, encrypted_token: '' } });
  }
  const fields = platform ? PROFILE_FIELDS[platform] ?? [] : Object.values(PROFILE_FIELDS).flat();
  if (fields.length) {
    await prisma.businessProfile.updateMany({
      where: { id: { in: businessIds } },
      data: Object.fromEntries(fields.map(f => [f, null])),
    });
  }
}
