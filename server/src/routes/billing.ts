/**
 * billing.ts — Paddle billing routes.
 *
 * Routes:
 *   GET  /api/billing/status               → subscription status, card, recent charges
 *   POST /api/billing/checkout             → new subscription: Paddle transaction id for Paddle.js;
 *                                            existing subscription: switch plan in place
 *   POST /api/billing/portal               → Paddle customer portal link (card, cancel, invoices)
 *   POST /api/billing/update-quantity      → sync branch count to subscription quantity
 *   GET  /api/billing/invoices/:txnId/pdf  → short-lived invoice PDF link
 *   POST /api/billing/webhooks             → Paddle notifications (signature-verified)
 *
 * Pricing is plan_price × branch_count / month: branch count is the
 * subscription quantity, kept in sync by syncPaddleQuantity().
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import {
  paddleEnabled, paddleRequest, priceIds, planFromPriceId,
  verifyPaddleSignature, PLAN_PRICES,
} from '../lib/paddle';
import { createLogger } from '../infra/logger';

const router = Router();
const logger = createLogger('BillingRoutes');

// Paddle statuses that mean the customer is (still) entitled to the paid plan.
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ── Helper: get org for user ──────────────────────────────────────────────────

async function getUserOrg(userId: string, orgId?: string): Promise<any | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      orgId
        ? `SELECT o.* FROM organizations o
           JOIN organization_members om ON om.org_id = o.id
           WHERE o.id = $1 AND om.user_id = $2 AND om.status = 'active'
           LIMIT 1`
        : `SELECT o.* FROM organizations o
           JOIN organization_members om ON om.org_id = o.id
           WHERE om.user_id = $1 AND om.status = 'active'
           ORDER BY o.created_at ASC LIMIT 1`,
      ...(orgId ? [orgId, userId] : [userId]),
    );
    return rows?.[0] || null;
  } catch { return null; }
}

async function setOrgPlan(orgId: string, planId: string, status: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET plan_id = $1, subscription_status = $2 WHERE id = $3`,
    planId, status, orgId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET subscription_plan = $1 WHERE organization_id = $2`,
    planId, orgId,
  );
}

const toUnix = (iso?: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

// ── GET /api/billing/status ───────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const org = await getUserOrg(userId, req.query.orgId as string | undefined);
  if (!org) return res.json({ plan: 'free_trial', status: 'none', branchCount: 1 });

  let invoices: any[] = [];
  let paymentMethod: any = null;
  let currentPeriodEnd: number | null = null;
  let cancelAtPeriodEnd = false;

  if (paddleEnabled() && org.paddle_subscription_id) {
    try {
      const sub = await paddleRequest('GET', `/subscriptions/${org.paddle_subscription_id}`);
      currentPeriodEnd = toUnix(sub.current_billing_period?.ends_at);
      cancelAtPeriodEnd = sub.scheduled_change?.action === 'cancel';

      const txns = await paddleRequest<any[]>(
        'GET',
        `/transactions?subscription_id=${org.paddle_subscription_id}&status=completed,past_due&order_by=billed_at[DESC]&per_page=6`,
      );
      invoices = txns.map(t => ({
        id: t.id,
        date: toUnix(t.billed_at || t.created_at),
        amount: Number(t.details?.totals?.grand_total || 0), // minor units (agorot)
        currency: t.currency_code,
        status: t.status === 'completed' ? 'paid' : t.status,
        hasInvoice: !!t.invoice_number,
      }));

      const card = txns
        .flatMap(t => t.payments || [])
        .find(p => p.status === 'captured' && p.method_details?.card)?.method_details.card;
      if (card) {
        paymentMethod = {
          brand: card.type,
          last4: card.last4,
          exp: `${String(card.expiry_month).padStart(2, '0')}/${String(card.expiry_year).slice(-2)}`,
        };
      }
    } catch (e: any) {
      logger.warn('Failed to fetch Paddle subscription', { error: e.message });
    }
  }

  return res.json({
    orgId: org.id,
    plan: org.plan_id || 'free_trial',
    status: org.subscription_status || 'none',
    subscriptionId: org.paddle_subscription_id || null,
    branchCount: org.branch_count || 1,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    paymentMethod,
    invoices,
    pricePerBranch: PLAN_PRICES[org.plan_id] || null,
    totalMonthly: org.plan_id && PLAN_PRICES[org.plan_id]
      ? PLAN_PRICES[org.plan_id] * (org.branch_count || 1)
      : null,
  });
});

// ── POST /api/billing/checkout ────────────────────────────────────────────────

router.post('/checkout', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { planId, orgId } = req.body;
  if (!planId || !(planId in PLAN_PRICES)) return res.status(400).json({ error: 'Unknown planId' });

  const org = await getUserOrg(userId, orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  if (!paddleEnabled()) {
    // Without billing configured a paid plan must never be granted for free in
    // production. Local dev keeps the direct flip so plan-gated UI is testable.
    if (process.env.NODE_ENV === 'production') {
      logger.error('Checkout attempted but PADDLE_API_KEY is not set');
      return res.status(503).json({ error: 'מערכת התשלומים אינה זמינה כרגע — נסה שוב מאוחר יותר' });
    }
    await setOrgPlan(org.id, planId, 'active');
    return res.json({ ok: true, devBypass: true });
  }

  const priceId = priceIds()[planId];
  if (!priceId) return res.status(400).json({ error: `No Paddle price configured for plan: ${planId}` });

  const quantity = Math.max(1, org.branch_count || 1);

  try {
    // Already subscribed → change plan on the existing subscription (prorated)
    // instead of opening a second checkout that would double-bill.
    if (org.paddle_subscription_id && ENTITLED_STATUSES.has(org.subscription_status)) {
      await paddleRequest('PATCH', `/subscriptions/${org.paddle_subscription_id}`, {
        items: [{ price_id: priceId, quantity }],
        proration_billing_mode: 'prorated_immediately',
      });
      // The subscription.updated webhook is the source of truth; this just
      // makes the UI reflect the switch without waiting for it.
      await setOrgPlan(org.id, planId, org.subscription_status);
      return res.json({ ok: true, changed: true });
    }

    const txn = await paddleRequest('POST', '/transactions', {
      items: [{ price_id: priceId, quantity }],
      custom_data: { org_id: org.id, plan_id: planId },
      ...(org.paddle_customer_id ? { customer_id: org.paddle_customer_id } : {}),
    });
    return res.json({ transactionId: txn.id });
  } catch (err: any) {
    logger.error('Checkout error', { error: err.message });
    return res.status(500).json({ error: 'שגיאה ביצירת התשלום — נסה שוב' });
  }
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────

router.post('/portal', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!paddleEnabled()) return res.status(503).json({ error: 'Billing not configured' });

  const org = await getUserOrg(userId, req.body.orgId);
  if (!org?.paddle_customer_id) return res.status(404).json({ error: 'No billing customer found' });

  try {
    const session = await paddleRequest('POST', `/customers/${org.paddle_customer_id}/portal-sessions`, {
      subscription_ids: org.paddle_subscription_id ? [org.paddle_subscription_id] : [],
    });
    return res.json({
      url: session.urls?.general?.overview,
      updatePaymentUrl: session.urls?.subscriptions?.[0]?.update_subscription_payment_method || null,
    });
  } catch (err: any) {
    logger.error('Portal error', { error: err.message });
    return res.status(500).json({ error: 'שגיאה בפתיחת ניהול התשלום' });
  }
});

// ── Branch count → subscription quantity ─────────────────────────────────────

/** Sync branch count to the Paddle subscription quantity. Throws on Paddle errors. */
export async function syncPaddleQuantity(orgId: string): Promise<'updated' | 'unchanged' | 'skipped'> {
  if (!paddleEnabled()) return 'skipped';
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT paddle_subscription_id, subscription_status, branch_count FROM organizations WHERE id = $1 LIMIT 1`,
    orgId,
  );
  const org = rows?.[0];
  if (!org?.paddle_subscription_id || !ENTITLED_STATUSES.has(org.subscription_status)) return 'skipped';

  const sub = await paddleRequest('GET', `/subscriptions/${org.paddle_subscription_id}`);
  const item = sub.items?.[0];
  if (!item) return 'skipped';

  const newQty = Math.max(1, org.branch_count || 1);
  if (item.quantity === newQty) return 'unchanged';

  await paddleRequest('PATCH', `/subscriptions/${org.paddle_subscription_id}`, {
    items: [{ price_id: item.price.id, quantity: newQty }],
    proration_billing_mode: 'prorated_immediately',
  });
  logger.info('Paddle quantity updated', { orgId, qty: newQty });
  return 'updated';
}

router.post('/update-quantity', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const org = await getUserOrg(userId, req.body.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  try {
    return res.json({ ok: true, result: await syncPaddleQuantity(org.id) });
  } catch (err: any) {
    logger.error('Update quantity error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/billing/invoices/:txnId/pdf ──────────────────────────────────────

router.get('/invoices/:txnId/pdf', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!paddleEnabled()) return res.status(503).json({ error: 'Billing not configured' });

  const org = await getUserOrg(userId, req.query.orgId as string | undefined);
  if (!org?.paddle_customer_id) return res.status(404).json({ error: 'Not found' });

  try {
    // Only hand out invoices that belong to this org's Paddle customer.
    const txn = await paddleRequest('GET', `/transactions/${encodeURIComponent(req.params.txnId)}`);
    if (txn.customer_id !== org.paddle_customer_id) return res.status(404).json({ error: 'Not found' });

    const pdf = await paddleRequest('GET', `/transactions/${txn.id}/invoice`);
    return res.json({ url: pdf.url });
  } catch (err: any) {
    logger.warn('Invoice PDF error', { error: err.message });
    return res.status(500).json({ error: 'החשבונית אינה זמינה כרגע' });
  }
});

// ── POST /api/billing/webhooks ────────────────────────────────────────────────
// Raw body comes from the global express.json verify hook (req.rawBody).

router.post('/webhooks', async (req: Request, res: Response) => {
  const ok = verifyPaddleSignature(
    (req as any).rawBody,
    req.headers['paddle-signature'] as string | undefined,
    process.env.PADDLE_WEBHOOK_SECRET,
  );
  if (!ok) {
    logger.warn('Paddle webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    await handlePaddleEvent(req.body);
  } catch (err: any) {
    // 500 → Paddle retries with backoff; handlers are idempotent so replays are safe.
    logger.error('Paddle webhook handler error', { type: req.body?.event_type, error: err.message });
    return res.status(500).json({ error: 'handler_failed' });
  }
  return res.json({ received: true });
});

export async function handlePaddleEvent(event: any) {
  const type: string = event?.event_type || '';
  const data = event?.data;
  logger.info('Paddle webhook', { type, id: event?.event_id });

  if (type.startsWith('subscription.')) {
    await applySubscription(data, event?.occurred_at);
  }
  // transaction.* events need no handling: the subscription.* event that
  // accompanies every successful payment carries the state we store, and a
  // card declined inside checkout must not flip anything.
}

async function applySubscription(sub: any, occurredAt?: string) {
  if (!sub?.id) return;

  let orgId: string | undefined = sub.custom_data?.org_id;
  if (!orgId) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM organizations WHERE paddle_subscription_id = $1 LIMIT 1`, sub.id,
    );
    orgId = rows?.[0]?.id;
  }
  if (!orgId) {
    logger.warn('Paddle subscription with no matching org', { subscriptionId: sub.id });
    return;
  }

  const item = sub.items?.[0];
  const status: string = sub.status; // active | trialing | past_due | paused | canceled
  const entitled = ENTITLED_STATUSES.has(status);
  const planId = entitled
    ? (planFromPriceId(item?.price?.id || '') || sub.custom_data?.plan_id || 'starter')
    : 'free_trial';

  // Paddle doesn't guarantee delivery order; an older event (e.g. a delayed
  // subscription.created) must not overwrite state from a newer one.
  const eventAt = occurredAt ? new Date(occurredAt) : new Date();
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE organizations
     SET paddle_customer_id = $1, paddle_subscription_id = $2,
         subscription_status = $3, plan_id = $4,
         branch_count = GREATEST(branch_count, $5),
         current_period_end = $6, paddle_event_at = $8
     WHERE id = $7 AND (paddle_event_at IS NULL OR paddle_event_at <= $8)`,
    sub.customer_id, sub.id,
    status === 'canceled' ? 'cancelled' : status, planId,
    item?.quantity || 1,
    sub.current_billing_period?.ends_at ? new Date(sub.current_billing_period.ends_at) : null,
    orgId, eventAt,
  );
  if (!updated) {
    logger.info('Skipped stale Paddle event', { subscriptionId: sub.id, occurredAt });
    return;
  }
  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET subscription_plan = $1 WHERE organization_id = $2`,
    planId, orgId,
  );
}

export default router;
