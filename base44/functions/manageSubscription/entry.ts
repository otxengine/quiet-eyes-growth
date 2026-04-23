import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.14.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, returnUrl } = await req.json();

    // Find customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return Response.json({ error: 'No customer found' }, { status: 404 });
    }

    const customerId = customers.data[0].id;

    if (action === 'portal') {
      // Create Stripe customer portal session to manage payment method / cancel
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      console.log(`Portal session created for ${user.email}`);
      return Response.json({ url: session.url });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Manage subscription error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});