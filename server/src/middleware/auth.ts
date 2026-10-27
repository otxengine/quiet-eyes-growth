import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

const clerkKey = process.env.CLERK_SECRET_KEY || '';
const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY || '';
// Real keys only: sk_test_/sk_live_ + 20 or more characters, and a publishable key whose body
// decodes to "<frontend api host>$" (Clerk's own format check). A placeholder (your_key_here,
// .env.example's sk_test_...) leaves Clerk off, and the production boot guard refuses to start.
export function isRealClerkKeys(secretKey: string, publishableKey: string): boolean {
  return /^sk_(test|live)_[^.\s]{20,}$/.test(secretKey) &&
    /^pk_(test|live)_/.test(publishableKey) && Buffer.from(publishableKey.slice(8), 'base64').toString().endsWith('$');
}
export const CLERK_ENABLED = isRealClerkKeys(clerkKey, clerkPubKey);
// Without Clerk every request runs as a dev user. Local runs only: production fails closed.
const DEV_MODE = !CLERK_ENABLED && process.env.NODE_ENV !== 'production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Constant-time secret compare. Hashing both sides first keeps the length out of the timing too. */
export function safeEqual(given: unknown, secret: string): boolean {
  if (typeof given !== 'string' || !secret) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export function isAdminKeyRequest(req: Request): boolean {
  return safeEqual(req.headers['x-admin-key'], ADMIN_SECRET);
}

/** The cron trigger's secret, from the x-cron-secret header only: a query string ends up in CDN and WAF logs. */
export function isCronRequest(req: Request): boolean {
  return safeEqual(req.headers['x-cron-secret'], process.env.CRON_SECRET || '');
}

/**
 * The app's own frontend origins, from FRONTEND_URL (comma-separated; on AWS the stack sets it to
 * the site's CloudFront / custom-domain URL). Clerk's authorizedParties and the OAuth popup's
 * postMessage targets come from here.
 */
export function frontendOrigins(): string[] {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')
    .map(o => { try { return new URL(o.trim()).origin; } catch { return ''; } })
    .filter(Boolean);
}

/**
 * Clerk session middleware. authorizedParties: a session token whose azp (the origin it was
 * minted for) isn't one of our frontends is refused. Admin-key requests skip Clerk, which
 * keeps a session cookie from interfering.
 */
export function clerkAuth(authorizedParties: string[]) {
  const { clerkMiddleware } = require('@clerk/express');
  const clerk = clerkMiddleware({ publishableKey: clerkPubKey, authorizedParties });
  return (req: Request, res: Response, next: NextFunction) => (req.headers['x-admin-key'] ? next() : clerk(req, res, next));
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!CLERK_ENABLED) return DEV_MODE ? next() : res.status(401).json({ error: 'Unauthorized' });
  const { getAuth } = require('@clerk/express');
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  (req as any).userId = userId;
  next();
}

const ALLOWED_DEV_USERS = new Set(['dev-user', 'dev-user-2', 'dev-user-3']);

export function getUserId(req: Request): string | null {
  if (!CLERK_ENABLED) {
    if (!DEV_MODE) return null;
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
