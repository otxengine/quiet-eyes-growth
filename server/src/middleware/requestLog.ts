import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../infra/logger';
import { getUserId } from './auth';

const logger = createLogger('http');
const QUIET_PATHS = new Set(['/healthz', '/api/healthz', '/api/health']); // load balancer and uptime pings

/**
 * One access-log line per request, tagged with a request ID that is also sent back as
 * X-Request-Id. Only the path is logged: query strings can carry secrets (the cron secret,
 * webhook tokens, OAuth codes), and no headers or bodies are logged. 401s and 403s, which
 * include admin-key and cron-secret failures, are logged at warn so they can be searched and
 * alarmed on.
 */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID();
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const status = res.statusCode;
    if (QUIET_PATHS.has(path) && status < 400) return;
    const level = status >= 500 ? 'error' : status === 401 || status === 403 ? 'warn' : 'info';
    logger[level](`${req.method} ${path} ${status}`, {
      status,
      ms: Date.now() - start,
      ip: req.ip,
      user: getUserId(req) ?? undefined,
    }, id);
  });
  next();
}
