import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.14.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

const PRODUCT_TO_PLAN = {
  'prod_UEieQfiS41tnN3': 'free',
  'prod_UEieUF3LbPMVfu': 'pro',
  'prod_UEieE9NwVSDGfP': 'enterprise',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return Response.json({ plan: 'free', status: 'none', invoices: [] });
    }

    const customer = customers.data[0];
    
    // Get active subscription
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
    
    let plan = 'free';
    let status = 'none';
    let currentPeriodEnd = null;
    let subscriptionId = null;

    if (subs.data.length > 0) {
      const sub = subs.data[0];
      subscriptionId = sub.id;
      status = sub.status;
      currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
      const productId = sub.items.data[0]?.price?.product;
      plan = PRODUCT_TO_PLAN[productId] || 'free';
    }

    // Get recent invoices
    const invoicesResp = await stripe.invoices.list({ customer: customer.id, limit: 10 });
    const invoices = invoicesResp.data.map(inv => ({
      id: inv.number || inv.id,
      date: new Date(inv.created * 1000).toLocaleDateString('he-IL'),
      amount: `₪${(inv.amount_paid / 100).toFixed(0)}`,
      status: inv.status === 'paid' ? 'שולם' : inv.status === 'open' ? 'פתוח' : inv.status,
      pdf: inv.invoice_pdf,
    }));

    // Get payment method
    let paymentMethod = null;
    if (customer.invoice_settings?.default_payment_method) {
      const pm = await stripe.paymentMethods.retrieve(customer.invoice_settings.default_payment_method);
      paymentMethod = {
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '****',
        exp: `${String(pm.card?.exp_month).padStart(2, '0')}/${String(pm.card?.exp_year).slice(-2)}`,
      };
    }

    console.log(`Subscription status for ${user.email}: plan=${plan}, status=${status}`);
    return Response.json({ plan, status, currentPeriodEnd, subscriptionId, invoices, paymentMethod });
  } catch (error) {
    console.error('Get subscription error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});