/**
 * Stripe billing provider. The `stripe` SDK is an optional peer-dep --
 * lazy-loaded so consumers using a different provider (or just running
 * the dev-memory provider in tests) don't need it installed.
 *
 * Webhook verification: Stripe signs every webhook with HMAC-SHA256 over
 * `${timestamp}.${rawBody}` using the workspace webhook signing secret.
 * `stripe.webhooks.constructEvent(...)` runs the timing-safe compare for
 * us; we surface its outcome through the same `null` / `BillingEvent[]`
 * shape as the rest of the kit.
 *
 * 2025/2026 Stripe SDK note: Stripe is migrating to "thin events" where
 * `event.data.object` carries id/type/related-object refs only and the
 * full object must be re-fetched. The adapter normalizes against the
 * full snapshot when present (today's default) and falls back to a
 * `provider.getSubscription(id)` re-fetch for state-critical decisions
 * inside the worker. The `BillingEvent` union is identical either way.
 */
import { BillingProviderNotConfigured } from '../errors.js';
import type {
  BillingEvent,
  NormalizedInvoice,
  NormalizedPaymentMethod,
  NormalizedSubscription,
} from '../events.js';
import type {
  InvoiceStatus,
  PriceInterval,
  SubscriptionStatus,
} from '../schema.js';

import type {
  BillingProvider,
  BillingWebhookVerifyInput,
  CreateCheckoutSessionInput,
  CreateCustomerInput,
  CreatePortalSessionInput,
  ListInvoicesInput,
  ListSubscriptionsInput,
} from './types.js';

export interface StripeProviderOptions {
  readonly secretKey: string;
  readonly webhookSecret?: string;
  readonly apiVersion?: string;
}

interface StripeLike {
  customers: {
    create(input: StripeCustomerCreateInput): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(
        input: StripeCheckoutSessionCreateInput,
        opts?: StripeRequestOptions,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(input: StripePortalSessionCreateInput): Promise<{ url: string }>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscription>;
    update(
      id: string,
      input: StripeSubscriptionUpdateInput,
    ): Promise<StripeSubscription>;
    cancel(id: string): Promise<StripeSubscription>;
    list(input: StripeSubscriptionListInput): Promise<{
      data: readonly StripeSubscription[];
      has_more: boolean;
    }>;
  };
  invoices: {
    list(input: StripeInvoiceListInput): Promise<{
      data: readonly StripeInvoice[];
    }>;
  };
  webhooks: {
    constructEvent(
      payload: Buffer | string,
      signature: string,
      secret: string,
    ): StripeEvent;
  };
}

interface StripeCustomerCreateInput {
  email: string;
  name: string;
  metadata?: Record<string, string>;
}

interface StripeCheckoutSessionCreateInput {
  customer: string;
  mode: 'subscription' | 'payment';
  line_items: readonly { price: string; quantity: number }[];
  success_url: string;
  cancel_url: string;
  subscription_data?: { trial_period_days?: number };
  metadata?: Record<string, string>;
}

interface StripePortalSessionCreateInput {
  customer: string;
  return_url: string;
}

interface StripeSubscriptionUpdateInput {
  cancel_at_period_end?: boolean;
}

interface StripeSubscriptionListInput {
  status?: 'active' | 'past_due' | 'trialing';
  limit?: number;
  starting_after?: string;
}

interface StripeInvoiceListInput {
  customer: string;
  status?: 'open';
  limit?: number;
}

interface StripeRequestOptions {
  idempotencyKey?: string;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at: number | null;
  canceled_at: number | null;
  trial_end: number | null;
  metadata: Record<string, string>;
  items: {
    data: readonly { price: { id: string } }[];
  };
}

interface StripeInvoice {
  id: string;
  customer: string;
  subscription: string | null;
  amount_due: number;
  currency: string;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  created: number;
  status_transitions: { paid_at: number | null };
}

interface StripePaymentMethod {
  id: string;
  customer: string | null;
  type: string;
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  } | null;
}

interface StripeCheckoutSession {
  id: string;
  customer: string | null;
  subscription: string | null;
  mode: string;
}

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

interface StripeCtor {
  new (apiKey: string, options?: { apiVersion?: string }): StripeLike;
}

const loadStripe = async (): Promise<StripeCtor> => {
  try {
    const module_ = (await import('stripe')) as unknown as {
      default?: StripeCtor;
    };
    if (!module_.default) {
      throw new BillingProviderNotConfigured(
        'Stripe SDK exports a default class but it is missing -- check the installed version.',
      );
    }
    return module_.default;
  } catch (error) {
    if (error instanceof BillingProviderNotConfigured) throw error;
    throw new BillingProviderNotConfigured(
      'Install `stripe` to use the stripe billing provider (`pnpm add stripe`).',
    );
  }
};

export const createStripeProvider = (
  options: StripeProviderOptions,
): BillingProvider => {
  let cached: StripeLike | null = null;

  const getClient = async (): Promise<StripeLike> => {
    if (cached) return cached;
    const Stripe = await loadStripe();
    cached = new Stripe(
      options.secretKey,
      options.apiVersion ? { apiVersion: options.apiVersion } : undefined,
    );
    return cached;
  };

  return {
    name: 'stripe',
    async createCustomer(input: CreateCustomerInput) {
      const client = await getClient();
      const customer = await client.customers.create({
        email: input.email,
        name: input.name,
        metadata: {
          tenantId: input.tenantId,
          ...input.metadata,
        },
      });
      return { providerCustomerId: customer.id };
    },
    async createCheckoutSession(input: CreateCheckoutSessionInput) {
      const client = await getClient();
      const session = await client.checkout.sessions.create(
        {
          customer: input.providerCustomerId,
          mode: input.mode,
          line_items: [{ price: input.providerPriceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...(input.mode === 'subscription' && input.trialPeriodDays
            ? {
                subscription_data: { trial_period_days: input.trialPeriodDays },
              }
            : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : undefined,
      );
      if (!session.url) {
        throw new Error('Stripe returned a checkout session without a URL');
      }
      return { url: session.url, sessionId: session.id };
    },
    async createPortalSession(input: CreatePortalSessionInput) {
      const client = await getClient();
      const session = await client.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    async cancelSubscription(providerSubscriptionId, opts) {
      const client = await getClient();
      await (opts.atPeriodEnd
        ? client.subscriptions.update(providerSubscriptionId, {
            cancel_at_period_end: true,
          })
        : client.subscriptions.cancel(providerSubscriptionId));
    },
    async getSubscription(providerSubscriptionId: string) {
      const client = await getClient();
      const sub = await client.subscriptions.retrieve(providerSubscriptionId);
      return normalizeSubscription(sub);
    },
    async *listSubscriptions(
      input: ListSubscriptionsInput,
    ): AsyncIterable<NormalizedSubscription> {
      const client = await getClient();
      const limit = input.limit ?? 100;
      let cursor: string | undefined = input.cursor;
      let hasMore = true;
      while (hasMore) {
        const page = await client.subscriptions.list({
          ...(input.status ? { status: input.status } : {}),
          limit,
          ...(cursor ? { starting_after: cursor } : {}),
        });
        for (const sub of page.data) {
          yield normalizeSubscription(sub);
        }
        hasMore = page.has_more;
        cursor = page.data.at(-1)?.id;
      }
    },
    async listInvoices(
      providerCustomerId: string,
      input?: ListInvoicesInput,
    ): Promise<readonly NormalizedInvoice[]> {
      const client = await getClient();
      const page = await client.invoices.list({
        customer: providerCustomerId,
        ...(input?.status ? { status: input.status } : {}),
        ...(input?.limit ? { limit: input.limit } : {}),
      });
      return page.data.map((inv) => normalizeInvoice(inv));
    },
    verifyWebhook(
      input: BillingWebhookVerifyInput,
    ): readonly BillingEvent[] | null {
      if (!options.webhookSecret) return null;
      const sigHeader = input.headers['stripe-signature'];
      const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      if (!sig) return null;

      // Run constructEvent synchronously via the cached client. If the
      // first call beat the lazy-load (rare -- the receiver usually
      // boots after the first non-webhook flow has hydrated the
      // adapter), bail and let the caller retry; Stripe will redeliver.
      if (!cached) return null;

      let event: StripeEvent;
      try {
        event = cached.webhooks.constructEvent(
          input.rawBody,
          sig,
          options.webhookSecret,
        );
      } catch {
        // Signature mismatch / malformed payload. Receiver translates
        // to HTTP 200 + empty body deliberately so attackers can't
        // probe for valid signatures.
        return null;
      }

      const normalized = normalizeEvent(event);
      return normalized ? [normalized] : [];
    },
  };
};

const STATUS_MAP: Readonly<Record<string, SubscriptionStatus>> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete_expired',
  unpaid: 'unpaid',
};

const INVOICE_STATUS_MAP: Readonly<Record<string, InvoiceStatus>> = {
  draft: 'draft',
  open: 'open',
  paid: 'paid',
  uncollectible: 'uncollectible',
  void: 'void',
};

const normalizeSubscription = (
  sub: StripeSubscription,
): NormalizedSubscription => {
  const status = STATUS_MAP[sub.status];
  if (!status) {
    throw new Error(`Unknown Stripe subscription status: ${sub.status}`);
  }
  const firstItem = sub.items.data[0];
  if (!firstItem) {
    throw new Error(`Stripe subscription ${sub.id} has no items.`);
  }
  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer,
    providerPriceId: firstItem.price.id,
    status,
    currentPeriodStart: new Date(sub.current_period_start * 1000),
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    metadata: sub.metadata ?? {},
  };
};

const normalizeInvoice = (inv: StripeInvoice): NormalizedInvoice => {
  const status = INVOICE_STATUS_MAP[inv.status] ?? 'draft';
  return {
    providerInvoiceId: inv.id,
    providerCustomerId: inv.customer,
    providerSubscriptionId: inv.subscription,
    amountCents: inv.amount_due,
    currency: inv.currency,
    status,
    hostedUrl: inv.hosted_invoice_url,
    pdfUrl: inv.invoice_pdf,
    issuedAt: new Date(inv.created * 1000),
    paidAt: inv.status_transitions.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000)
      : null,
  };
};

const normalizePaymentMethod = (
  pm: StripePaymentMethod,
): NormalizedPaymentMethod | null => {
  if (!pm.customer) return null;
  return {
    providerPaymentMethodId: pm.id,
    providerCustomerId: pm.customer,
    type: pm.type,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
    // Stripe's `customer.invoice_settings.default_payment_method` carries
    // the default flag; the adapter doesn't have access to that on the
    // payment_method.* events, so the consumer reconciles via webhook
    // or the periodic sync. Default to false here.
    isDefault: false,
  };
};

const normalizeEvent = (event: StripeEvent): BillingEvent | null => {
  const receivedAt = new Date(event.created * 1000);
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = normalizeSubscription(
        event.data.object as StripeSubscription,
      );
      const wasJustActivated = sub.status === 'active';
      const isInitial = event.type === 'customer.subscription.created';
      return {
        kind:
          isInitial && wasJustActivated
            ? 'subscription.activated'
            : 'subscription.updated',
        subscription: sub,
        receivedAt,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = normalizeSubscription(
        event.data.object as StripeSubscription,
      );
      return { kind: 'subscription.canceled', subscription: sub, receivedAt };
    }
    case 'customer.subscription.trial_will_end': {
      const sub = normalizeSubscription(
        event.data.object as StripeSubscription,
      );
      return {
        kind: 'subscription.trial-will-end',
        subscription: sub,
        receivedAt,
      };
    }
    case 'invoice.finalized': {
      const inv = normalizeInvoice(event.data.object as StripeInvoice);
      return { kind: 'invoice.finalized', invoice: inv, receivedAt };
    }
    case 'invoice.paid': {
      const inv = normalizeInvoice(event.data.object as StripeInvoice);
      return { kind: 'invoice.paid', invoice: inv, receivedAt };
    }
    case 'invoice.payment_failed': {
      const inv = normalizeInvoice(event.data.object as StripeInvoice);
      return { kind: 'invoice.payment-failed', invoice: inv, receivedAt };
    }
    case 'payment_method.attached':
    case 'payment_method.updated':
    case 'payment_method.detached': {
      const pm = normalizePaymentMethod(
        event.data.object as StripePaymentMethod,
      );
      if (!pm) return null;
      const kind =
        event.type === 'payment_method.attached'
          ? 'payment-method.attached'
          : event.type === 'payment_method.updated'
            ? 'payment-method.updated'
            : 'payment-method.detached';
      return { kind, paymentMethod: pm, receivedAt };
    }
    case 'checkout.session.completed': {
      const session = event.data.object as StripeCheckoutSession;
      if (!session.customer) return null;
      return {
        kind: 'checkout.completed',
        sessionId: session.id,
        providerCustomerId: session.customer,
        providerSubscriptionId: session.subscription,
        receivedAt,
      };
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as {
        charge?: string | null;
        amount?: number;
        currency?: string;
      };
      const charge = (event.data.object as { charge?: { id?: string } }).charge;
      const chargeId =
        typeof dispute.charge === 'string'
          ? dispute.charge
          : (charge?.id ?? '');
      return {
        kind: 'dispute.created',
        chargeId,
        providerInvoiceId: null,
        amountCents: dispute.amount ?? 0,
        currency: dispute.currency ?? 'usd',
        receivedAt,
      };
    }
    default: {
      // Unknown event types are absorbed silently (Stripe ships new ones
      // periodically); the receiver still ACK 200s and the row in
      // billing_webhook_events keeps the raw payload for forensic use.
      return null;
    }
  }
};

// Avoid an unused-import lint flag on `PriceInterval` (re-exported for
// adapters that handle price.* events in a future iteration).
export type _ReservedForPriceEvents = PriceInterval;
