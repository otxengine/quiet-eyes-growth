/**
 * stripe.ts — Stripe SDK singleton + helpers.
 *
 * Env vars needed:
 *   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    — whsec_...
 *   STRIPE_PRICE_STARTER     — price_xxx  (₪149/branch/month)
 *   STRIPE_PRICE_GROWTH      — price_xxx  (₪349/branch/month)
 *   STRIPE_PRICE_PRO         — price_xxx  (₪699/branch/month)
 */

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';
export const stripeEnabled = !!key && !key.includes('sk_test_...');

export const stripe: Stripe = stripeEnabled
  ? new Stripe(key, { apiVersion: '2023-10-16' })
  : (null as any);

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export const PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || '',
  growth:  process.env.STRIPE_PRICE_GROWTH  || '',
  pro:     process.env.STRIPE_PRICE_PRO     || '',
};

export const PLAN_PRICES: Record<string, number> = {
  starter: 149,
  growth:  349,
  pro:     699,
};

export const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  growth:  'Growth',
  pro:     'Pro',
};

/** Map Stripe price ID → plan key */
export function planFromPriceId(priceId: string): string {
  for (const [plan, pid] of Object.entries(PRICE_IDS)) {
    if (pid && pid === priceId) return plan;
  }
  return 'starter';
}
