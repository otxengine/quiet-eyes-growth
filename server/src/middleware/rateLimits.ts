import rateLimit from 'express-rate-limit';

// General API: 1500 requests per 15 minutes per IP. A page load makes 12-25 API calls, so the
// old 300 locked out a normal user after about 15 page views. Abuse is also capped at the edge
// (prod WAF: 2000 requests per 5 minutes per IP); expensive endpoints keep strictLimiter below.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Asking for an account-less Free setup link (routes/briefing.ts): 5 per 15 min per IP. Its own
// counter, so link requests and the setup searches don't eat each other's allowance.
export const freeRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in a few minutes.' },
});

// Strict limiter for expensive LLM/scan endpoints: 20 per 15 min
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for scan/AI endpoints' },
});
