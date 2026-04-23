import { Request, Response, NextFunction } from 'express';

const clerkKey = process.env.CLERK_SECRET_KEY || '';
const CLERK_ENABLED = clerkKey && !clerkKey.includes('your_key_here');

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
