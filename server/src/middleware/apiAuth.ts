import { Request, Response, NextFunction } from 'express';
import { getUserId, isAdminKeyRequest } from './auth';

/**
 * /api paths reachable without a Clerk user. Health checks; webhooks and the
 * cron trigger (each verifies its own signature or secret); OAuth redirect
 * targets; and media URLs that <img> tags and Meta's servers load directly,
 * which can't carry an Authorization header.
 */
const PUBLIC_API_PATHS: RegExp[] = [
  /^\/healthz?$/,
  /^\/cron\/run$/,
  /^\/migrate$/,
  /^\/webhooks\//,
  /^\/billing\/webhooks$/,
  /^\/oauth\/(callback\/[^/]+|confirm-page)$/,
  /^\/competitors\/proxy-image$/,
  /^\/social\/media\/[^/]+$/,
];

/**
 * Mounted on /api ahead of every router. Deny by default: a route is public
 * only when listed above, so a new router can't ship unauthenticated. Tenant
 * ownership is still each router's job (middleware/businessAccess.ts).
 */
export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_API_PATHS.some(p => p.test(req.path)) || isAdminKeyRequest(req) || getUserId(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
