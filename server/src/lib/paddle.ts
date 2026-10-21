/**
 * paddle.ts — Paddle Billing API client + helpers.
 *
 * Paddle is the merchant of record: it charges the card, issues the invoice
 * and remits VAT; we only create transactions, read subscriptions and react
 * to webhooks.
 *
 * Env vars needed:
 *   PADDLE_API_KEY         — server-side API key (pdl_live_apikey_… / pdl_sdbx_apikey_…)
 *   PADDLE_WEBHOOK_SECRET  — notification destination secret (pdl_ntfset_…)
 *   PADDLE_ENV             — 'sandbox' | 'production' (default production)
 *   PADDLE_PRICE_STARTER   — pri_…  (₪149/branch/month)
 *   PADDLE_PRICE_GROWTH    — pri_…  (₪349/branch/month)
 *   PADDLE_PRICE_PRO       — pri_…  (₪699/branch/month)
 *
 * Read lazily (not at import) so tests and env edits see the current values.
 */

import crypto from 'crypto';

export const PLAN_PRICES: Record<string, number> = {
  starter: 149,
  growth:  349,
  pro:     699,
};

/** API key as pasted into the dashboard, minus stray whitespace, quotes or a "Bearer " prefix. */
function apiKey(): string {
  return (process.env.PADDLE_API_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export function paddleEnabled(): boolean {
  return !!apiKey();
}

/**
 * Describes the configured key without revealing it, for diagnosing auth
 * failures from logs: which kind of credential it looks like, its length,
 * and whether it matches PADDLE_ENV.
 */
export function describeApiKey(): string {
  const raw = process.env.PADDLE_API_KEY || '';
  const key = apiKey();
  const kind =
    key.startsWith('pdl_sdbx_apikey_') ? 'sandbox API key' :
    key.startsWith('pdl_live_apikey_') ? 'live API key' :
    /^(test|live)_/.test(key) ? 'client-side token (wrong credential: needs the API key)' :
    key.startsWith('pdl_ntfset_') ? 'webhook secret (wrong credential: needs the API key)' :
    'unrecognized format';
  const env = process.env.PADDLE_ENV === 'sandbox' ? 'sandbox' : 'production';
  const mismatch =
    (kind === 'sandbox API key' && env !== 'sandbox') || (kind === 'live API key' && env === 'sandbox')
      ? ` — does not match PADDLE_ENV=${env}` : '';
  const cleaned = raw !== key ? ', had extra whitespace/quotes (stripped)' : '';
  return `${kind}, length ${key.length}${cleaned}${mismatch}`;
}

function apiBase(): string {
  return process.env.PADDLE_ENV === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
}

export function priceIds(): Record<string, string> {
  return {
    starter: process.env.PADDLE_PRICE_STARTER || '',
    growth:  process.env.PADDLE_PRICE_GROWTH  || '',
    pro:     process.env.PADDLE_PRICE_PRO     || '',
  };
}

/** Map Paddle price ID → plan key (null when the price isn't one of ours). */
export function planFromPriceId(priceId: string): string | null {
  for (const [plan, pid] of Object.entries(priceIds())) {
    if (pid && pid === priceId) return plan;
  }
  return null;
}

/** Thin fetch wrapper: returns `data` from Paddle's envelope, throws with Paddle's error detail. */
export async function paddleRequest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    let detail = json?.error?.detail || json?.error?.code || res.statusText;
    if (res.status === 401 || res.status === 403) detail += ` [configured key: ${describeApiKey()}]`;
    throw Object.assign(new Error(`Paddle ${method} ${path}: ${detail}`), { status: res.status });
  }
  return json.data as T;
}

const SIGNATURE_TOLERANCE_SEC = 5 * 60;

/**
 * Verifies the Paddle-Signature header ("ts=…;h1=…"): HMAC-SHA256 of
 * `${ts}:${rawBody}` with the destination secret. Rejects stale timestamps
 * so a captured request can't be replayed later.
 */
export function verifyPaddleSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!rawBody || !header || !secret) return false;

  const parts = Object.fromEntries(
    header.split(';').map(p => p.split('=') as [string, string]),
  );
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!ts || !h1) return false;
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(h1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
