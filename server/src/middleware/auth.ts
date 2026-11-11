import { Request, Response, NextFunction } from 'express';

const clerkKey = process.env.CLERK_SECRET_KEY || '';
const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY || '';
const CLERK_ENABLED = clerkKey && !clerkKey.includes('your_key_here') &&
                      clerkPubKey && !clerkPubKey.includes('your_key_here');

// Admin panel access: Clerk user ids, comma-separated. Unset = nobody is an admin.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER_IDS = new Set((process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!CLERK_ENABLED) return next();
  const { getAuth } = require('@clerk/express');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  (req as any).userId = userId;
  next();
}

const ALLOWED_DEV_USERS = new Set(['dev-user', 'dev-user-2', 'dev-user-3']);

export function getUserId(req: Request): string | null {
  if (!CLERK_ENABLED) {
    const devUser = req.headers['x-dev-user'];
    if (typeof devUser === 'string' && ALLOWED_DEV_USERS.has(devUser)) {
      return devUser;
    }
    return 'dev-user';
  }
  try {
    const { getAuth } = require('@clerk/express');
    return getAuth(req)?.userId || null;
  } catch {
    return null;
  }
}

/**
 * Admin panel and system-wide routes: a signed-in user listed in ADMIN_USER_IDS.
 * Sets req.adminUserId. 401 signed out; 403 'not_admin'.
 * Being an admin never widens the tenant checks of the regular app routes.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Without Clerk every caller is 'dev-user'; never let that be an admin in production.
  if (!CLERK_ENABLED && IS_PRODUCTION) return res.status(503).json({ error: 'auth_not_configured' });
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!ADMIN_USER_IDS.has(userId)) return res.status(403).json({ error: 'not_admin' });
  // ponytail: no second-factor check, Clerk MFA needs a paid plan. When it's on, require
  // getAuth(req).factorVerificationAge[1] >= 0 here (it is -1 when the session skipped the second factor).
  (req as any).adminUserId = userId;
  next();
}
