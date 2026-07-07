/**
 * stripe.ts — Stripe billing routes.
 *
 * Routes:
 *   GET  /api/stripe/status          → subscription status for current org
 *   POST /api/stripe/checkout        → create Stripe Checkout Session (quantity = branch count)
 *   POST /api/stripe/portal          → create Billing Portal session
 *   POST /api/stripe/update-quantity → sync branch count to existing subscription
 *   POST /api/stripe/webhooks        → Stripe webhook handler (raw body required)
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getUserId } from '../middleware/auth';
import { stripe, stripeEnabled, WEBHOOK_SECRET, PRICE_IDS, PLAN_PRICES, planFromPriceId } from '../lib/stripe';
import { createLogger } from '../infra/logger';

const router = Router();
const logger = createLogger('StripeRoutes');

type Params = Record<string, string>;

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

async function getUserEmail(userId: string): Promise<string> {
  // Try to get email from business_profiles created_by chain (Clerk userId stored there)
  // In most deployments we don't have a separate users table, so we just return empty
  // and let Stripe prompt the user for email during checkout.
  return '';
}

// ── GET /api/stripe/status ────────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const orgId = req.query.orgId as string | undefined;
  const org = await getUserOrg(userId, orgId);
  if (!org) return res.json({ plan: 'free_trial', status: 'none', branchCount: 1 });

  // Fetch live subscription from Stripe if connected
  let invoices: any[] = [];
  let paymentMethod: any = null;
  let currentPeriodEnd: number | null = null;

  if (stripeEnabled && org.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id, {
        expand: ['latest_invoice', 'default_payment_method'],
      });

      const item = sub.items.data[0];
      currentPeriodEnd = sub.current_period_end;

      // Sync back to DB if status changed
      if (sub.status !== org.subscription_status) {
        await prisma.$executeRawUnsafe(
          `UPDATE organizations SET subscription_status = $1 WHERE id = $2`,
          sub.status, org.id,
        );
      }

      // Payment method
      const pm = sub.default_payment_method as any;
      if (pm?.card) {
        paymentMethod = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
      }

      // Recent invoices
      const invList = await stripe.invoices.list({ subscription: org.stripe_subscription_id, limit: 6 });
      invoices = invList.data.map(inv => ({
        id: inv.id,
        date: inv.created,
        amount: inv.amount_paid / 100,
        currency: inv.currency,
        status: inv.status,
        url: inv.hosted_invoice_url,
      }));
    } catch (e: any) {
      logger.warn('Failed to fetch Stripe subscription', { error: e.message });
    }
  }

  return res.json({
    orgId: org.id,
    plan: org.plan_id || 'free_trial',
    status: org.subscription_status || 'none',
    stripeCustomerId: org.stripe_customer_id || null,
    stripeSubscriptionId: org.stripe_subscription_id || null,
    branchCount: org.branch_count || 1,
    currentPeriodEnd,
    paymentMethod,
    invoices,
    pricePerBranch: PLAN_PRICES[org.plan_id] || null,
    totalMonthly: org.plan_id && PLAN_PRICES[org.plan_id]
      ? PLAN_PRICES[org.plan_id] * (org.branch_count || 1)
      : null,
  });
});

// ── POST /api/stripe/checkout ─────────────────────────────────────────────────

router.post('/checkout', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { planId, orgId, returnUrl } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId required' });

  if (!stripeEnabled) {
    // ponytail: no Stripe key configured (real prod always has one) — flip the plan directly instead of checking out
    const org = await getUserOrg(userId, orgId);
    if (!org) return res.status(404).json({ error: 'Org not found' });
    await prisma.$executeRawUnsafe(
      `UPDATE organizations SET plan_id = $1, subscription_status = 'active' WHERE id = $2`,
      planId, org.id,
    );
    return res.json({ ok: true, devBypass: true });
  }

  const priceId = PRICE_IDS[planId];
  if (!priceId) return res.status(400).json({ error: `No Stripe price configured for plan: ${planId}` });

  const org = await getUserOrg(userId, orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  const branchCount = Math.max(1, org.branch_count || 1);
  const email = await getUserEmail(userId);
  const baseUrl = returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;

  try {
    // Reuse existing Stripe customer or create new
    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { org_id: org.id, user_id: userId },
      });
      customerId = customer.id;
      await prisma.$executeRawUnsafe(
        `UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2`,
        customerId, org.id,
      );
    }

    // If subscription already exists → redirect to portal for upgrade/change
    if (org.stripe_subscription_id) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: baseUrl,
      });
      return res.json({ url: portalSession.url });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: branchCount }],
      success_url: `${baseUrl}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}?canceled=true`,
      subscription_data: {
        metadata: { org_id: org.id, plan_id: planId, branch_count: String(branchCount) },
      },
      metadata: { org_id: org.id, plan_id: planId },
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    logger.error('Checkout error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/stripe/portal ───────────────────────────────────────────────────

router.post('/portal', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!stripeEnabled) return res.status(503).json({ error: 'Stripe not configured' });

  const { orgId, returnUrl } = req.body;
  const org = await getUserOrg(userId, orgId);
  if (!org?.stripe_customer_id) return res.status(404).json({ error: 'No Stripe customer found' });

  const baseUrl = returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: baseUrl,
    });
    return res.json({ url: session.url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/stripe/update-quantity ─────────────────────────────────────────
// Called internally when branch count changes to sync with Stripe.

router.post('/update-quantity', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!stripeEnabled) return res.json({ ok: true, skipped: 'stripe_not_configured' });

  const { orgId } = req.body;
  const org = await getUserOrg(userId, orgId);
  if (!org?.stripe_subscription_id) return res.json({ ok: true, skipped: 'no_subscription' });

  try {
    const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
    const item = sub.items.data[0];
    if (!item) return res.json({ ok: false, error: 'No subscription item' });

    const newQty = Math.max(1, org.branch_count || 1);
    if (item.quantity === newQty) return res.json({ ok: true, skipped: 'quantity_unchanged' });

    await stripe.subscriptionItems.update(item.id, {
      quantity: newQty,
      proration_behavior: 'create_prorations',
    });

    logger.info('Stripe quantity updated', { orgId: org.id, qty: newQty });
    return res.json({ ok: true, newQuantity: newQty });
  } catch (err: any) {
    logger.error('Update quantity error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/stripe/webhooks ─────────────────────────────────────────────────
// Stripe sends raw body — must be registered BEFORE express.json().

router.post('/webhooks', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const rawBody: Buffer = (req as any).rawBody;

  if (!stripeEnabled) return res.json({ received: true });

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err: any) {
    logger.warn('Webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    await handleWebhookEvent(event);
  } catch (err: any) {
    logger.error('Webhook handler error', { type: event.type, error: err.message });
    // Still return 200 so Stripe doesn't retry indefinitely
  }

  return res.json({ received: true });
});

async function handleWebhookEvent(event: any) {
  const type = event.type;
  logger.info('Stripe webhook', { type });

  switch (type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const orgId = session.metadata?.org_id;
      const planId = session.metadata?.plan_id;
      if (!orgId) break;

      const subId = session.subscription as string;
      const customerId = session.customer as string;

      await prisma.$executeRawUnsafe(
        `UPDATE organizations
         SET stripe_customer_id = $1, stripe_subscription_id = $2,
             plan_id = $3, subscription_status = 'active'
         WHERE id = $4`,
        customerId, subId, planId || 'starter', orgId,
      );

      // Also update all business profiles in this org
      await prisma.$executeRawUnsafe(
        `UPDATE business_profiles SET subscription_plan = $1 WHERE organization_id = $2`,
        planId || 'starter', orgId,
      );
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const orgId = sub.metadata?.org_id;
      if (!orgId) {
        // Look up by subscription ID
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM organizations WHERE stripe_subscription_id = $1 LIMIT 1`, sub.id,
        );
        if (!rows?.length) break;
        const oid = rows[0].id;
        await updateOrgFromSub(oid, sub);
      } else {
        await updateOrgFromSub(orgId, sub);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM organizations WHERE stripe_subscription_id = $1 LIMIT 1`, sub.id,
      );
      if (rows?.length) {
        await prisma.$executeRawUnsafe(
          `UPDATE organizations SET subscription_status = 'cancelled', plan_id = 'free_trial'
           WHERE id = $1`,
          rows[0].id,
        );
      }
      break;
    }

    case 'invoice.paid': {
      const inv = event.data.object;
      const subId = inv.subscription as string;
      if (!subId) break;

      // Save invoice to DB (optional — for display in UI)
      await prisma.$executeRawUnsafe(
        `INSERT INTO stripe_invoices (id, org_id, stripe_invoice_id, amount_paid, currency, status, invoice_url, period_start, period_end, created_at)
         SELECT gen_random_uuid()::text, o.id, $1, $2, $3, 'paid', $4, to_timestamp($5), to_timestamp($6), NOW()
         FROM organizations o WHERE o.stripe_subscription_id = $7
         ON CONFLICT (stripe_invoice_id) DO NOTHING`,
        inv.id, inv.amount_paid, inv.currency, inv.hosted_invoice_url || '',
        inv.period_start, inv.period_end, subId,
      ).catch(() => {}); // ignore if table doesn't exist yet
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const subId = inv.subscription as string;
      if (!subId) break;
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM organizations WHERE stripe_subscription_id = $1 LIMIT 1`, subId,
      );
      if (rows?.length) {
        await prisma.$executeRawUnsafe(
          `UPDATE organizations SET subscription_status = 'past_due' WHERE id = $1`,
          rows[0].id,
        );
      }
      break;
    }
  }
}

async function updateOrgFromSub(orgId: string, sub: any) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || '';
  const planId = planFromPriceId(priceId);
  const qty = item?.quantity || 1;

  await prisma.$executeRawUnsafe(
    `UPDATE organizations
     SET subscription_status = $1, plan_id = $2, branch_count = GREATEST(branch_count, $3),
         stripe_price_id = $4, current_period_end = to_timestamp($5)
     WHERE id = $6`,
    sub.status, planId, qty, priceId, sub.current_period_end, orgId,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE business_profiles SET subscription_plan = $1 WHERE organization_id = $2`,
    planId, orgId,
  );
}

export default router;
