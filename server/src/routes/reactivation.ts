/**
 * Reactivation — lets a user reclaim a business_profile that was deactivated
 * by the Clerk-deletion sync webhook (see ./webhooks/clerk.ts), if they sign
 * up again with the same email that owned it.
 *
 * GET  /api/reactivation/candidates          → deactivated businesses matching the caller's email
 * POST /api/reactivation/:businessProfileId/reactivate → reclaim one of them
 * POST /api/reactivation/retire-replaced     → deactivate the profile a re-onboarding replaced
 *
 * Deliberately does NOT touch organizations/organization_members — org
 * ownership/membership is never auto-restored, only business_profiles
 * (is_active/deactivated_at/created_by). Re-establishing org access, if
 * needed, is a separate manual step via the existing /api/orgs routes.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { getUserEmail } from '../lib/ownership';

const router = Router();

// ── GET /api/reactivation/candidates ──────────────────────────────────────

export async function getCandidatesHandler(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const email = await getUserEmail(userId);
  if (!email) return res.json([]);

  const candidates = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, city, category, deactivated_at
     FROM business_profiles
     WHERE lower(owner_email) = lower($1) AND is_active = false
     ORDER BY deactivated_at DESC NULLS LAST`,
    email,
  );
  return res.json(candidates);
}

router.get('/candidates', getCandidatesHandler);

// ── POST /api/reactivation/:businessProfileId/reactivate ─────────────────

export async function reactivateHandler(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { businessProfileId } = req.params as { businessProfileId: string };

  const email = await getUserEmail(userId);
  if (!email) return res.status(404).json({ error: 'Not found' });

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, owner_email FROM business_profiles WHERE id = $1 AND is_active = false LIMIT 1`,
    businessProfileId,
  );
  const profile = rows?.[0];

  // Single generic 404 for "doesn't exist", "not deactivated", and "wrong
  // owner" — don't let a signed-in user distinguish these via response shape.
  if (!profile || !profile.owner_email || profile.owner_email.toLowerCase() !== email.toLowerCase()) {
    return res.status(404).json({ error: 'Not found' });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET is_active = true, deactivated_at = NULL, created_by = $1 WHERE id = $2`,
    userId, businessProfileId,
  );

  return res.json({ ok: true });
}

router.post('/:businessProfileId/reactivate', reactivateHandler);

// ── POST /api/reactivation/retire-replaced ────────────────────────────────
// Re-running onboarding (Settings → "בצע קליטה מחדש") creates a NEW profile.
// Once it completes, retire the one it replaces — otherwise the scheduler keeps
// running every daily agent for both. Same is_active/deactivated_at/owner_email
// convention as the Clerk-deletion sync, so the old one is offered back by
// /candidates above. Only profiles the caller created directly (no org access).

export async function retireReplacedHandler(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newProfileId, replacedProfileId } = req.body ?? {};
  if (!newProfileId || !replacedProfileId || newProfileId === replacedProfileId) {
    return res.status(400).json({ error: 'newProfileId and a different replacedProfileId are required' });
  }

  const email = await getUserEmail(userId);
  const owned = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, onboarding_completed FROM business_profiles
     WHERE id IN ($1, $2) AND (created_by = $3 OR lower(created_by) = lower($4))`,
    newProfileId, replacedProfileId, userId, email ?? userId,
  );
  const fresh = owned?.find(p => p.id === newProfileId);
  if (owned?.length !== 2 || !fresh) return res.status(404).json({ error: 'Not found' });
  if (!fresh.onboarding_completed) {
    return res.status(409).json({ error: 'New profile has not finished onboarding' });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles
     SET is_active = false, deactivated_at = NOW(), owner_email = COALESCE(owner_email, $2)
     WHERE id = $1 AND (is_active IS NULL OR is_active = true)`,
    replacedProfileId, email,
  );
  return res.json({ ok: true });
}

router.post('/retire-replaced', retireReplacedHandler);

export default router;
