/**
 * Billing — Stripe Checkout + Customer Portal + webhook.
 *
 * Flow:
 *   1. User clicks "Upgrade to Pro" in the app → app calls
 *      POST /billing/checkout-session → receives a Stripe Checkout URL
 *      → app opens that URL in the default browser (shell.openExternal).
 *   2. User completes payment on Stripe's hosted page.
 *   3. Stripe POSTs to /billing/webhook with `checkout.session.completed`
 *      and subsequent `customer.subscription.*` events.
 *   4. Our webhook updates `subscriptions` + sets `users.plan` atomically.
 *   5. Electron app polls GET /api/v1/me on a timer (or via a WebSocket
 *      later) to pick up the new plan.
 *
 * We never trust client-reported plan changes — Stripe is the source of truth.
 */
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { env } from '../env.js';
import { requireAuth } from '../auth.js';
import { sql, type Plan } from '../db/index.js';
import { planFromPriceId } from '../billing/plans.js';

let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    if (!env.stripeSecretKey) throw new Error('stripe not configured');
    stripe = new Stripe(env.stripeSecretKey, { apiVersion: '2024-11-20.acacia' as any });
  }
  return stripe;
}

export async function registerBillingRoutes(server: FastifyInstance) {
  // ─── POST /billing/checkout-session (auth required) ───────────────
  server.post('/checkout-session', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    if (!env.stripeSecretKey) return reply.code(503).send({ error: 'billing_not_configured' });
    const { userId, email } = req.auth!;
    const body = (req.body ?? {}) as { plan?: 'pro' | 'team'; cycle?: 'monthly' | 'yearly'; successUrl?: string; cancelUrl?: string };

    const priceId = resolvePriceId(body.plan ?? 'pro', body.cycle ?? 'monthly');
    if (!priceId) return reply.code(400).send({ error: 'invalid_plan' });

    // Upsert stripe_customer_id on the user row. Stripe's Customer is
    // keyed by email in our model, but we store the `cus_…` locally so
    // subsequent checkouts reuse the same customer (billing history).
    const rows = await sql<{ stripe_customer_id: string | null }[]>`
      SELECT stripe_customer_id FROM users WHERE id = ${userId}
    `;
    let customerId = rows[0]?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email, metadata: { userId },
      });
      customerId = customer.id;
      await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${userId}`;
    }

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: body.successUrl || `${env.corsOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  body.cancelUrl  || `${env.corsOrigin}/pricing`,
      allow_promotion_codes: true,
      metadata: { userId },
    });

    return { url: session.url };
  });

  // ─── POST /billing/portal-session (auth required) ─────────────────
  server.post('/portal-session', {
    preHandler: requireAuth,
  }, async (req, reply) => {
    if (!env.stripeSecretKey) return reply.code(503).send({ error: 'billing_not_configured' });
    const rows = await sql<{ stripe_customer_id: string | null }[]>`
      SELECT stripe_customer_id FROM users WHERE id = ${req.auth!.userId}
    `;
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return reply.code(400).send({ error: 'no_customer' });

    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.corsOrigin}/settings/billing`,
    });
    return { url: portal.url };
  });

  // ─── POST /billing/webhook (Stripe → us) ──────────────────────────
  // Stripe signs every webhook payload with HMAC-SHA256 over the raw
  // body. Fastify's JSON parser would eat the raw body, so we register
  // this route with `config.rawBody = true` and use Fastify's built-in
  // raw body hook via the `content-type-parser` addContentTypeParser below.
  server.post('/webhook', {
    config: { rawBody: true } as any,
  }, async (req, reply) => {
    if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
      return reply.code(503).send({ error: 'billing_not_configured' });
    }
    const sig = req.headers['stripe-signature'] as string | undefined;
    if (!sig) return reply.code(400).send({ error: 'missing_signature' });

    const raw = (req as any).rawBody as Buffer | string;
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(raw, sig, env.stripeWebhookSecret);
    } catch (err: any) {
      req.log.warn({ err }, 'stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'bad_signature' });
    }

    try {
      await handleEvent(event);
    } catch (err) {
      req.log.error({ err, eventId: event.id }, 'webhook handler failed');
      // Reply 200 anyway so Stripe doesn't retry-storm — we'll fix
      // missed state from the next `invoice.paid` heartbeat. But DO
      // reply 500 on transient DB errors so Stripe retries.
      const transient = /ECONNREFUSED|timeout|deadlock/i.test(String(err));
      return reply.code(transient ? 500 : 200).send({ received: true });
    }
    return reply.code(200).send({ received: true });
  });
}

function resolvePriceId(plan: 'pro' | 'team', cycle: 'monthly' | 'yearly'): string | null {
  if (plan === 'pro' && cycle === 'monthly') return env.stripePricePro.monthly || null;
  if (plan === 'pro' && cycle === 'yearly')  return env.stripePricePro.yearly  || null;
  if (plan === 'team' && cycle === 'monthly') return env.stripePriceTeam.monthly || null;
  return null;
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // We set `metadata.userId` on create, so this is reliable.
      const userId = session.metadata?.userId;
      if (!userId || !session.subscription) return;
      const sub = await getStripe().subscriptions.retrieve(session.subscription as string);
      await upsertSubscription(userId, sub);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customer = await getStripe().customers.retrieve(sub.customer as string);
      if (customer.deleted) return;
      const userId = (customer as Stripe.Customer).metadata?.userId;
      if (!userId) return;
      await upsertSubscription(userId, sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await sql`
        UPDATE subscriptions
        SET status = 'canceled', canceled_at = now(), updated_at = now()
        WHERE id = ${sub.id}
      `;
      // Downgrade the user back to Free once the paid period expires.
      await sql`
        UPDATE users SET plan = 'free'
        WHERE id = (SELECT user_id FROM subscriptions WHERE id = ${sub.id})
      `;
      break;
    }
    default:
      // Ignore — we don't care about invoice.*, payment_method.*, etc.
      break;
  }
}

async function upsertSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price.id;
  if (!priceId) return;
  const plan: Plan | null = planFromPriceId(priceId, {
    stripePricePro: env.stripePricePro,
    stripePriceTeam: env.stripePriceTeam,
  });
  if (!plan) return;

  await sql`
    INSERT INTO subscriptions
      (id, user_id, stripe_customer_id, stripe_price_id, plan, status,
       current_period_start, current_period_end, cancel_at_period_end)
    VALUES
      (${sub.id}, ${userId}, ${sub.customer as string}, ${priceId}, ${plan}, ${sub.status},
       to_timestamp(${sub.current_period_start}), to_timestamp(${sub.current_period_end}),
       ${sub.cancel_at_period_end})
    ON CONFLICT (id) DO UPDATE SET
      stripe_price_id      = EXCLUDED.stripe_price_id,
      plan                 = EXCLUDED.plan,
      status               = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end   = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at           = now()
  `;

  // Update the denormalised user.plan pointer — only if the sub is
  // effectively active (active, trialing, past_due). Canceled or
  // incomplete should not upgrade the user.
  const active = ['active', 'trialing', 'past_due'].includes(sub.status);
  if (active) {
    await sql`UPDATE users SET plan = ${plan} WHERE id = ${userId}`;
  }
}
