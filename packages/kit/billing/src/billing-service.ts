/**
 * High-level billing operations consumed by routes + the
 * `billing.process-event` worker.
 *
 * - **`createCheckoutSession({ tenantId, priceId, ... })`** -- looks up
 *   or creates the tenant's billing customer for the active provider,
 *   resolves the local `prices` row to its provider price id, and asks
 *   the adapter for a Checkout URL.
 * - **`createPortalSession(tenantId, returnUrl)`** -- self-serve
 *   subscription management.
 * - **`cancelSubscription(subId, opts)`** -- delegates to the adapter;
 *   final status arrives via webhook.
 * - **`dispatchEvent(event)`** -- worker entry point. Pivots on
 *   `event.kind`, routes to the right repo mutator, busts entitlements
 *   cache for subscription events. Returns the updated row(s) so the
 *   worker can emit audit + enqueue mail.
 *
 * `successUrl` / `cancelUrl` / `returnUrl` are validated against an
 * allowlist origin to prevent open-redirect through Stripe.
 */
import type {
  BillingCustomerRow,
  BillingCustomersRepository,
} from './billing-customers-repository.js';
import type { EntitlementsService } from './entitlements-service.js';
import {
  BillingCustomerMissing,
  BillingRedirectUrlNotAllowed,
} from './errors.js';
import {
  isInvoiceEvent,
  isPaymentMethodEvent,
  isSubscriptionEvent,
} from './events.js';
import type { BillingEvent, NormalizedSubscription } from './events.js';
import type { InvoicesRepository, InvoiceRow } from './invoices-repository.js';
import type {
  PaymentMethodRow,
  PaymentMethodsRepository,
} from './payment-methods-repository.js';
import type { PlansRepository, PricesRepository } from './plans-repository.js';
import type { BillingProvider } from './providers/types.js';
import type { BillingDB } from './schema.js';
import type {
  SubscriptionRow,
  SubscriptionsRepository,
} from './subscriptions-repository.js';

export interface CreateCheckoutInput {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantEmail: string;
  readonly priceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly trialPeriodDays?: number;
}

export interface CreatePortalInput {
  readonly tenantId: string;
  readonly tenantEmail: string;
  readonly tenantName: string;
  readonly returnUrl: string;
}

export type DispatchEventResult =
  | { readonly applied: 'subscription'; readonly row: SubscriptionRow }
  | { readonly applied: 'invoice'; readonly row: InvoiceRow }
  | { readonly applied: 'payment-method'; readonly row: PaymentMethodRow }
  | { readonly applied: 'payment-method-detached' }
  | { readonly applied: 'checkout'; readonly providerCustomerId: string }
  | { readonly applied: 'dispute' }
  | { readonly applied: 'skipped'; readonly reason: string };

export interface BillingService {
  createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<{ url: string; sessionId: string }>;
  createPortalSession(input: CreatePortalInput): Promise<{ url: string }>;
  cancelSubscription(
    subscriptionRow: SubscriptionRow,
    opts: { atPeriodEnd: boolean },
  ): Promise<void>;
  dispatchEvent(event: BillingEvent): Promise<DispatchEventResult>;
}

export interface BillingServiceDeps<DB extends BillingDB> {
  readonly provider: BillingProvider;
  readonly billingCustomersRepository: BillingCustomersRepository<DB>;
  readonly subscriptionsRepository: SubscriptionsRepository<DB>;
  readonly invoicesRepository: InvoicesRepository<DB>;
  readonly paymentMethodsRepository: PaymentMethodsRepository<DB>;
  readonly plansRepository: PlansRepository;
  readonly pricesRepository: PricesRepository;
  readonly entitlementsService: EntitlementsService;
  /** URL origin allowed for `successUrl`/`cancelUrl`/`returnUrl`. The
   * route layer enforces; the service double-checks because checkout is
   * the highest-leverage redirect surface in the kit. */
  readonly redirectAllowlistOrigin: string;
}

const isUrlAllowed = (url: string, allowedOrigin: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
};

const requireAllowedUrl = (url: string, allowedOrigin: string): void => {
  if (!isUrlAllowed(url, allowedOrigin)) {
    throw new BillingRedirectUrlNotAllowed(url);
  }
};

export const createBillingService = <DB extends BillingDB>({
  provider,
  billingCustomersRepository,
  subscriptionsRepository,
  invoicesRepository,
  paymentMethodsRepository,
  plansRepository,
  pricesRepository,
  entitlementsService,
  redirectAllowlistOrigin,
}: BillingServiceDeps<DB>): BillingService => {
  const ensureCustomer = async (input: {
    tenantId: string;
    tenantName: string;
    tenantEmail: string;
  }): Promise<BillingCustomerRow> => {
    const existing = await billingCustomersRepository.findByTenantAndProvider(
      input.tenantId,
      provider.name,
    );
    if (existing) return existing;
    const created = await provider.createCustomer({
      email: input.tenantEmail,
      name: input.tenantName,
      tenantId: input.tenantId,
    });
    return await billingCustomersRepository.upsert({
      tenantId: input.tenantId,
      provider: provider.name,
      providerCustomerId: created.providerCustomerId,
      email: input.tenantEmail,
    });
  };

  const resolveCustomerForEvent = async (
    providerCustomerId: string,
  ): Promise<BillingCustomerRow> => {
    const row = await billingCustomersRepository.findByProviderCustomerId(
      provider.name,
      providerCustomerId,
    );
    if (!row) {
      throw new BillingCustomerMissing(providerCustomerId, provider.name);
    }
    return row;
  };

  const resolvePlanForSubscription = async (
    sub: NormalizedSubscription,
  ): Promise<string | null> => {
    const price = await pricesRepository.findByProviderPriceId(
      sub.providerPriceId,
    );
    if (!price) return null;
    const plan = await plansRepository.findById(price.planId);
    return plan?.id ?? null;
  };

  return {
    async createCheckoutSession(input) {
      requireAllowedUrl(input.successUrl, redirectAllowlistOrigin);
      requireAllowedUrl(input.cancelUrl, redirectAllowlistOrigin);
      const customer = await ensureCustomer(input);
      const price = await pricesRepository.findById(input.priceId);
      if (!price) {
        throw new Error(`Price ${input.priceId} not found.`);
      }
      return await provider.createCheckoutSession({
        providerCustomerId: customer.providerCustomerId,
        priceId: price.id,
        providerPriceId: price.providerPriceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        mode: price.interval === 'one_time' ? 'payment' : 'subscription',
        ...(input.trialPeriodDays
          ? { trialPeriodDays: input.trialPeriodDays }
          : {}),
        idempotencyKey: `checkout:${input.tenantId}:${price.id}`,
        metadata: { tenantId: input.tenantId },
      });
    },

    async createPortalSession(input) {
      requireAllowedUrl(input.returnUrl, redirectAllowlistOrigin);
      const customer = await ensureCustomer(input);
      return await provider.createPortalSession({
        providerCustomerId: customer.providerCustomerId,
        returnUrl: input.returnUrl,
      });
    },

    async cancelSubscription(subscriptionRow, opts) {
      await provider.cancelSubscription(
        subscriptionRow.providerSubscriptionId,
        opts,
      );
      // Final status (`canceled`) lands via webhook; the local row stays
      // as-is until then so admin reads still show the active period.
    },

    async dispatchEvent(event) {
      if (isSubscriptionEvent(event)) {
        const customer = await resolveCustomerForEvent(
          event.subscription.providerCustomerId,
        );
        const planId = await resolvePlanForSubscription(event.subscription);
        const row = await subscriptionsRepository.upsertFromEvent({
          tenantId: customer.tenantId,
          billingCustomerId: customer.id,
          planId,
          subscription: event.subscription,
        });
        await entitlementsService.invalidate(customer.tenantId);
        return { applied: 'subscription', row };
      }

      if (isInvoiceEvent(event)) {
        const customer = await resolveCustomerForEvent(
          event.invoice.providerCustomerId,
        );
        let subscriptionId: string | null = null;
        if (event.invoice.providerSubscriptionId) {
          const sub =
            await subscriptionsRepository.findByProviderSubscriptionId(
              event.invoice.providerSubscriptionId,
            );
          subscriptionId = sub?.id ?? null;
        }
        const row = await invoicesRepository.upsertFromEvent({
          tenantId: customer.tenantId,
          billingCustomerId: customer.id,
          subscriptionId,
          invoice: event.invoice,
        });
        return { applied: 'invoice', row };
      }

      if (isPaymentMethodEvent(event)) {
        const customer = await resolveCustomerForEvent(
          event.paymentMethod.providerCustomerId,
        );
        if (event.kind === 'payment-method.detached') {
          await paymentMethodsRepository.markDetached(
            event.paymentMethod.providerPaymentMethodId,
          );
          return { applied: 'payment-method-detached' };
        }
        const row = await paymentMethodsRepository.upsertFromEvent({
          tenantId: customer.tenantId,
          billingCustomerId: customer.id,
          paymentMethod: event.paymentMethod,
        });
        return { applied: 'payment-method', row };
      }

      if (event.kind === 'checkout.completed') {
        // Best-effort: the canonical truth comes via
        // `subscription.activated` shortly after. We just confirm the
        // customer exists; payment_methods + subscription rows arrive
        // through their own events.
        try {
          await resolveCustomerForEvent(event.providerCustomerId);
          return {
            applied: 'checkout',
            providerCustomerId: event.providerCustomerId,
          };
        } catch {
          return {
            applied: 'skipped',
            reason: 'unknown-customer',
          };
        }
      }

      if (event.kind === 'dispute.created') {
        // Audit-only in v1; no row mutation. The worker emits the audit
        // entry; admin gets a dashboard widget in a follow-up.
        return { applied: 'dispute' };
      }

      return { applied: 'skipped', reason: 'unhandled-event-kind' };
    },
  };
};
