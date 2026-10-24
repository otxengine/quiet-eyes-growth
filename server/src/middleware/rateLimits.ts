import rateLimit from 'express-rate-limit';
import { isAdminKeyRequest } from './auth';

// Only a configured, matching ADMIN_SECRET skips the limits; isAdminKeyRequest is false when it is unset.

// General API: 1500 requests per 15 minutes per IP. A page load makes 12-25 API calls, so the
// old 300 locked out a normal user after about 15 page views. Abuse is also capped at the edge
// (prod WAF: 2000 requests per 5 minutes per IP); expensive endpoints keep strictLimiter below.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: isAdminKeyRequest,
});

// Strict limiter for expensive LLM/scan endpoints: 20 per 15 min
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for scan/AI endpoints' },
  skip: isAdminKeyRequest,
});
