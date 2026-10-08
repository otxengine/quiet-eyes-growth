/**
 * Clerk Account-Deletion Sync Webhook
 *
 * POST /api/webhooks/clerk
 *
 * Keeps our own DB in sync with Clerk account lifecycle events:
 *  - user.created / user.updated → cache the verified primary email (Clerk's
 *    user.deleted payload carries NO email, so it must be captured ahead of
 *    time) and live-sync business_profiles.owner_email for active owners.
 *  - user.deleted → deactivate everything that Clerk user owned:
 *      1. business_profiles they created directly (created_by = userId)
 *      2. business_profiles under any organization they own
 *      3. revoke all of their organization_members rows (owned or not)
 *
 * Verification: Clerk signs webhooks with svix. Ack 200 immediately, then
 * process async — same pattern as ../meta/webhook.ts and ./dataforseo.ts.
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { prisma } from '../../db';

const router = Router();

type ClerkEmailAddress = {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
};

type ClerkUserEventData = {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
};

export type ClerkWebhookEvent = { type: string; data: ClerkUserEventData };

function extractVerifiedEmail(data: ClerkUserEventData): string | null {
  const addresses = data.email_addresses ?? [];
  const primary = addresses.find(a => a.id === data.primary_email_address_id) ?? addresses[0];
  if (!primary || primary.verification?.status !== 'verified') return null;
  return primary.email_address.toLowerCase();
}

export function clerkWebhookHandler(req: Request, res: Response) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!secret || !rawBody) {
    console.warn('[Clerk webhook] Rejecting — missing secret or raw body');
    return res.sendStatus(403);
  }

  try {
    new Webhook(secret).verify(rawBody, {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    });
  } catch (err: any) {
    console.warn('[Clerk webhook] Invalid signature — rejecting payload:', err.message);
    return res.sendStatus(403);
  }

  // Ack immediately — process after responding, same pattern as the other webhooks.
  res.sendStatus(200);

  processClerkWebhookEvent(req.body).catch(err => {
    console.error('[Clerk webhook] Processing error:', err.message);
  });
}

router.post('/', clerkWebhookHandler);

export async function processClerkWebhookEvent(evt: ClerkWebhookEvent): Promise<void> {
  const { type, data } = evt || {};
  const userId = data?.id;
  if (!userId) {
    console.warn('[Clerk webhook] Payload missing data.id — ignoring');
    return;
  }

  if (type === 'user.created' || type === 'user.updated') {
    const email = extractVerifiedEmail(data);
    await prisma.$executeRawUnsafe(
      `INSERT INTO clerk_user_cache (user_id, email, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET email = $2, updated_at = NOW()`,
      userId, email,
    );
    if (email) {
      await prisma.$executeRawUnsafe(
        `UPDATE business_profiles SET owner_email = $1
         WHERE created_by = $2 AND (is_active IS NULL OR is_active = true)`,
        email, userId,
      );
    }
    return;
  }

  if (type === 'user.deleted') {
    let cachedEmail: string | null = null;
    try {
      const rows = await prisma.$queryRawUnsafe<{ email: string | null }[]>(
        `SELECT email FROM clerk_user_cache WHERE user_id = $1 LIMIT 1`, userId,
      );
      cachedEmail = rows?.[0]?.email ?? null;
    } catch { /* cache table unavailable — proceed without an email backfill */ }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Businesses created directly by this user (no org, or org-linked but they're the creator)
        await tx.$executeRawUnsafe(
          `UPDATE business_profiles
           SET is_active = false, deactivated_at = NOW(), owner_email = COALESCE(owner_email, $1)
           WHERE created_by = $2 AND (is_active IS NULL OR is_active = true)`,
          cachedEmail, userId,
        );

        // 2. Businesses under any organization this user owns (covers org-linked
        //    profiles whose created_by isn't necessarily the owner).
        const ownedOrgs = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM organizations WHERE owner_user_id = $1`, userId,
        );
        for (const org of ownedOrgs) {
          await tx.$executeRawUnsafe(
            `UPDATE business_profiles
             SET is_active = false, deactivated_at = NOW(), owner_email = COALESCE(owner_email, $1)
             WHERE organization_id = $2 AND (is_active IS NULL OR is_active = true)`,
            cachedEmail, org.id,
          );
        }

        // 3. Revoke every membership this user holds, owned or not (matches the
        //    existing DELETE /api/orgs/:id/members/:memberId convention).
        await tx.$executeRawUnsafe(
          `UPDATE organization_members SET status = 'revoked' WHERE user_id = $1 AND status <> 'revoked'`,
          userId,
        );
      });
    } catch (err: any) {
      // organizations/organization_members may be unavailable in some envs —
      // same tolerant convention as ownership.ts:getUserBusinessIds.
      console.warn('[Clerk webhook] user.deleted cascade error (continuing):', err.message);
    }
  }
}

export default router;
