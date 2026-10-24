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

// 403 unless the caller owns every id. No ids → next(): the /api gate (requireApiAuth)
// already requires a signed-in caller, so this composes with public routes too.
async function ensureOwnsAll(req: Request, res: Response, next: NextFunction, ids: string[]) {
  if (!ids.length || isAdminKeyRequest(req)) return next();
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  let ownedIds: string[];
  try { ownedIds = await getUserBusinessIds(userId); } catch (err) { return next(err); }
  if (ids.some(id => !ownedIds.includes(id))) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const BUSINESS_ID_FIELDS = ['businessProfileId', 'businessId'];

/**
 * Router-level guard: every business id passed as ?businessProfileId= / ?businessId=
 * or in the JSON body must be one the caller owns. Non-string values are rejected so
 * an object like { not: 'x' } can't reach a Prisma where clause.
 */
export function requireOwnsBusinessFields(req: Request, res: Response, next: NextFunction) {
  const values = BUSINESS_ID_FIELDS.flatMap(f => [req.query?.[f], req.body?.[f]]).filter(v => v !== undefined && v !== null && v !== '');
  if (values.some(v => typeof v !== 'string')) return res.status(400).json({ error: 'Invalid business id' });
  return ensureOwnsAll(req, res, next, values as string[]);
}

/** router.param() handler for path params that hold a business id. */
export function ownsBusinessParam(req: Request, res: Response, next: NextFunction, id: string) {
  return ensureOwnsAll(req, res, next, [id]);
}

/**
 * Guards routes keyed by another row's id (a comment, a competitor...): `lookup`
 * returns that row's business id. 404 unless the caller owns it, so another
 * tenant's ids look the same as ids that don't exist.
 */
export function requireOwnsRecord(lookup: (id: string) => Promise<string | null | undefined>, param = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isAdminKeyRequest(req)) return next();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    let owned: boolean;
    try {
      const businessId = await lookup(String(req.params[param]));
      owned = !!businessId && (await getUserBusinessIds(userId)).includes(businessId);
    } catch (err) { return next(err); }
    if (!owned) return res.status(404).json({ error: 'Not found' });
    next();
  };
}

/** System-wide operations (all-business agent runs, pipeline internals, admin panel APIs). */
export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  if (isAdminKeyRequest(req)) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
