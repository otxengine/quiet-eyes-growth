import { Request, Response, NextFunction } from 'express';

// Route params that name the feature (function, entity type, platform), not a record — logged by value.
const FEATURE_PARAMS = new Set(['name', 'entity', 'platform']);
// Numbers (ids, phones) and long tokens with a digit (uuids, cuids, invite tokens); feature names have no digits.
const ID_SEGMENT = /^(\d+|(?=.*\d)[\w-]{16,})$/;

/**
 * One JSON line per /api request for CloudWatch: which Clerk user used which route for which
 * business. Route is the matched pattern (ids stay as :param); never the query string or body.
 */
export function accessLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (/^\/api\/healthz?$/.test(path)) return;
    const params = (req.params ?? {}) as Record<string, string>;
    const pattern = typeof req.route?.path === 'string' ? req.baseUrl + req.route.path : '';
    // Not under /api when a handler's error left the router (baseUrl reset): mask the raw path instead.
    const route = pattern.startsWith('/api')
      ? pattern.replace(/:(\w+)/g, (m, p) => (FEATURE_PARAMS.has(p) && /^[\w-]{1,64}$/.test(params[p] ?? '') ? params[p] : m))
      : path.split('/').map(s => (ID_SEGMENT.test(s) ? ':id' : s)).join('/');
    const business = params.businessProfileId || params.bpId || params.businessId
      || req.body?.businessProfileId || req.body?.linked_business || req.query?.businessProfileId;
    let user: string | null = null;
    try { user = require('@clerk/express').getAuth(req)?.userId ?? null; } catch { /* Clerk not mounted (dev) */ }
    console.log(JSON.stringify({
      type: 'access', method: req.method, route, status: res.statusCode, ms: Date.now() - start,
      user, business: typeof business === 'string' ? business : null, timestamp: new Date().toISOString(),
    }));
  });
  next();
}
