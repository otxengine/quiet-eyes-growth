import { Request, Response, NextFunction } from 'express';

/**
 * A 5xx body is whatever the handler had at hand: err.message, a Prisma code, an upstream (Graph,
 * Paddle) error body. Log it here and send a generic message instead. 4xx bodies are intentional
 * validation messages and go out as written.
 */
export function hideServerErrors(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    if (res.statusCode < 500) return json(body);
    // Path only: query strings can carry OAuth codes or secrets.
    console.error(`[${res.statusCode}] ${req.method} ${req.originalUrl.split('?')[0]}:`, JSON.stringify(body)?.slice(0, 2000));
    return json({ error: 'Internal server error' });
  };
  next();
}
