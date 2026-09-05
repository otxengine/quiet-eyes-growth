import { Request, Response, NextFunction } from 'express';
import { getUserId, isAdminKeyRequest } from './auth';
import { getUserBusinessIds } from '../lib/ownership';

/**
 * Guards POST /api/functions/:name. Most of the ~130 functions behind that
 * route take a `businessProfileId` in the body and use it directly in DB
 * queries with no ownership check — this closes that gap in one place
 * instead of patching every handler individually.
 */
export async function requireBusinessAccess(req: Request, res: Response, next: NextFunction) {
  if (isAdminKeyRequest(req)) return next();

  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const businessProfileId = req.body?.businessProfileId;
  if (businessProfileId) {
    const ownedIds = await getUserBusinessIds(userId);
    if (!ownedIds.includes(businessProfileId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  next();
}
