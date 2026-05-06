/**
 * Provider-agnostic billing port. Adapters in `providers/{stripe,
 * dev-memory}.ts` implement this; the kit's billing service + worker
 * call a single set of methods regardless of which provider is
 * configured.
 *
 * Returning normalized `BillingEvent`s from `verifyWebhook(...)` (rather
 * than raw provider event payloads) is the boundary that keeps Stripe
 * out of application code -- a future Paddle adapter contributes its
 * own translation, and `billing-service.dispatchEvent` doesn't change.
 */
import type {
  BillingEvent,
  NormalizedInvoice,
  NormalizedSubscription,
} from '../events.js';

export type BillingProviderName = 'stripe' | 'dev-memory';

/** Webhook input shared with `@kit/mailer`'s shape so the receiver
 * route doesn't need to know the provider. */
export interface BillingWebhookVerifyInput {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody: Buffer;
}

export interface CreateCustomerInput {
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CreateCheckoutSessionInput {
  readonly providerCustomerId: string;
  readonly priceId: string;
  /** Provider price id (e.g. `price_...`) -- distinct from our local
   * `prices.id` UUID. The kit looks up `prices.providerPriceId` and
   * passes it through. */
  readonly providerPriceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly mode: 'subscription' | 'payment';
  readonly trialPeriodDays?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CreatePortalSessionInput {
  readonly providerCustomerId: string;
  readonly returnUrl: string;
}

export interface ListSubscriptionsInput {
  readonly status?: 'active' | 'past_due' | 'trialing';
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListInvoicesInput {
  readonly status?: 'open';
  readonly limit?: number;
}

export interface BillingProvider {
  readonly name: BillingProviderName;

  createCustomer(
    input: CreateCustomerInput,
  ): Promise<{ providerCustomerId: string }>;

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<{ url: string; sessionId: string }>;

  createPortalSession(
    input: CreatePortalSessionInput,
  ): Promise<{ url: string }>;

  cancelSubscription(
    providerSubscriptionId: string,
    opts: { atPeriodEnd: boolean },
  ): Promise<void>;

  getSubscription(
    providerSubscriptionId: string,
  ): Promise<NormalizedSubscription>;

  /** AsyncIterable so callers can stream nightly reconciliation without
   * loading the full list into memory. */
  listSubscriptions(
    input: ListSubscriptionsInput,
  ): AsyncIterable<NormalizedSubscription>;

  listInvoices(
    providerCustomerId: string,
    input?: ListInvoicesInput,
  ): Promise<readonly NormalizedInvoice[]>;

  /** Provider-specific webhook decoder. Returns `null` when the request
   * fails verification (the receiver translates to HTTP 200 + empty body
   * to avoid leaking validity to attackers). Returns `[]` when the
   * payload is verified but contains no actionable events. */
  verifyWebhook(
    input: BillingWebhookVerifyInput,
  ): readonly BillingEvent[] | null;
}
