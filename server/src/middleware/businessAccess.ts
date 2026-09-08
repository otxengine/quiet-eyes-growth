import { Request, Response, NextFunction } from 'express';
import { getUserId, isAdminKeyRequest } from './auth';
import { getUserBusinessIds } from '../lib/ownership';

/**
 * Builds an ownership-check middleware for a route whose business id lives
 * somewhere other than req.body.businessProfileId (query param, a
 * differently-named body field, etc). Same enforcement as
 * requireBusinessAccess below, parameterized on where the id comes from.
 */
export function requireOwnsBusiness(extractId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isAdminKeyRequest(req)) return next();

    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const businessId = extractId(req);
    if (businessId) {
      const ownedIds = await getUserBusinessIds(userId);
      if (!ownedIds.includes(businessId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    next();
  };
}

/**
 * Guards POST /api/functions/:name. Most of the ~130 functions behind that
 * route take a `businessProfileId` in the body and use it directly in DB
 * queries with no ownership check — this closes that gap in one place
 * instead of patching every handler individually.
 */
export const requireBusinessAccess = requireOwnsBusiness(req => req.body?.businessProfileId);
