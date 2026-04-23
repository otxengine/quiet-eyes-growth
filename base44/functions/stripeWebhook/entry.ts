import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import Stripe from 'npm:stripe@14.14.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Map Stripe price IDs to internal plan names
const PLAN_MAP: Record<string, string> = {
  'price_1TGFDbK6BFqDyeZKbLD0WF9m': 'free',
  'price_1TGFDbK6BFqDyeZKcsu2GDJF': 'pro',
  'price_1TGFDbK6BFqDyeZKJBWjVCMI': 'enterprise',
};

async function findProfileByEmail(base44: any, email: string) {
  const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  return allProfiles.find((p: any) => p.created_by === email) || null;
}

async function findProfileByCustomerId(base44: any, customerId: string) {
  const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  return allProfiles.find((p: any) => p.stripe_customer_id === customerId) || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.text();
    const signature = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log(`Stripe webhook received: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const planId = session.metadata?.plan_id;
        const customerEmail = session.customer_details?.email || session.customer_email;

        if (planId && customerEmail) {
          const profile = await findProfileByEmail(base44, customerEmail);
          if (profile) {
            await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
              plan_id: planId,
              subscription_status: 'active',
              subscription_started_at: new Date().toISOString(),
              stripe_customer_id: session.customer as string,
            });
            console.log(`Plan ${planId} activated for ${customerEmail}`);
          } else {
            console.warn(`No business profile found for email: ${customerEmail}`);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`Subscription updated: ${sub.id}, status: ${sub.status}`);

        // Resolve plan from the first price item
        const priceId = sub.items?.data?.[0]?.price?.id;
        const planId = priceId ? (PLAN_MAP[priceId] || 'pro') : undefined;

        let email: string | null = null;
        if (sub.customer) {
          try {
            const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
            email = customer.email;
          } catch (err) {
            console.error('Failed to retrieve customer:', err.message);
          }
        }

        if (email) {
          const profile = await findProfileByEmail(base44, email);
          if (profile) {
            const updates: Record<string, any> = {
              subscription_status: sub.status === 'active' ? 'active' : sub.status === 'trialing' ? 'trialing' : 'past_due',
            };
            if (planId) updates.plan_id = planId;
            await base44.asServiceRole.entities.BusinessProfile.update(profile.id, updates);
            console.log(`Subscription updated for ${email}: status=${sub.status}, plan=${planId}`);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`Subscription canceled: ${sub.id}`);

        try {
          const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
          const email = customer.email;
          if (email) {
            const profile = await findProfileByEmail(base44, email);
            if (profile) {
              await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
                plan_id: 'free',
                subscription_status: 'canceled',
              });
              console.log(`Plan downgraded to free for ${email}`);
            }
          }
        } catch (err) {
          console.error('Failed to retrieve customer for cancellation:', err.message);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`Invoice payment failed: ${invoice.id}`);

        const customerId = invoice.customer as string;
        if (customerId) {
          try {
            const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
            const email = customer.email;
            if (email) {
              const profile = await findProfileByEmail(base44, email);
              if (profile) {
                await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
                  subscription_status: 'past_due',
                });
                console.log(`Marked past_due for ${email}`);
              }
            }
          } catch (err) {
            console.error('Failed to handle payment_failed:', err.message);
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`Invoice paid: ${invoice.id}, amount: ${invoice.amount_paid}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
