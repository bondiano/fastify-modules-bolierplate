/**
 * Normalized event shapes consumed by `billingService.dispatchEvent(...)`.
 * Provider-specific webhook payloads (Stripe.Event etc.) are translated
 * into one of these by the active adapter's `verifyWebhook(...)`.
 *
 * Keeping the application code on the normalized union (and never
 * importing `stripe`) is the abstraction's whole point -- a future
 * Paddle/LS adapter contributes its own translation layer, and `billing-
 * service.ts` doesn't change.
 *
 * `receivedAt` is the wall-clock time at the receiver; tied back to
 * `billing_webhook_events.received_at` so log correlation is trivial.
 */

import type {
  InvoiceStatus,
  PriceInterval,
  SubscriptionStatus,
} from './schema.js';

export interface NormalizedSubscription {
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly providerPriceId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAt: Date | null;
  readonly canceledAt: Date | null;
  readonly trialEnd: Date | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface NormalizedInvoice {
  readonly providerInvoiceId: string;
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly hostedUrl: string | null;
  readonly pdfUrl: string | null;
  readonly issuedAt: Date;
  readonly paidAt: Date | null;
}

export interface NormalizedPaymentMethod {
  readonly providerPaymentMethodId: string;
  readonly providerCustomerId: string;
  readonly type: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expMonth: number | null;
  readonly expYear: number | null;
  readonly isDefault: boolean;
}

export interface NormalizedPrice {
  readonly providerPriceId: string;
  readonly providerProductId: string;
  readonly currency: string;
  readonly amountCents: number;
  readonly interval: PriceInterval;
  readonly isActive: boolean;
}

export interface CheckoutCompletedPayload {
  readonly sessionId: string;
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string | null;
}

export interface DisputeCreatedPayload {
  readonly chargeId: string;
  readonly providerInvoiceId: string | null;
  readonly amountCents: number;
  readonly currency: string;
}

/** Discriminated union covering every event the kit's `billingService.
 * dispatchEvent` knows how to handle. Adding a new event kind is a
 * type-driven exercise: extend the union here, add the matching branch
 * in `billing-service.ts`, ship the adapter translation. */
export type BillingEvent =
  | {
      readonly kind: 'subscription.activated';
      readonly subscription: NormalizedSubscription;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'subscription.updated';
      readonly subscription: NormalizedSubscription;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'subscription.canceled';
      readonly subscription: NormalizedSubscription;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'subscription.trial-will-end';
      readonly subscription: NormalizedSubscription;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'invoice.finalized';
      readonly invoice: NormalizedInvoice;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'invoice.paid';
      readonly invoice: NormalizedInvoice;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'invoice.payment-failed';
      readonly invoice: NormalizedInvoice;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'payment-method.attached';
      readonly paymentMethod: NormalizedPaymentMethod;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'payment-method.detached';
      readonly paymentMethod: NormalizedPaymentMethod;
      readonly receivedAt: Date;
    }
  | {
      readonly kind: 'payment-method.updated';
      readonly paymentMethod: NormalizedPaymentMethod;
      readonly receivedAt: Date;
    }
  | ({
      readonly kind: 'checkout.completed';
      readonly receivedAt: Date;
    } & CheckoutCompletedPayload)
  | ({
      readonly kind: 'dispute.created';
      readonly receivedAt: Date;
    } & DisputeCreatedPayload);

export type BillingEventKind = BillingEvent['kind'];

export const isSubscriptionEvent = (
  event: BillingEvent,
): event is Extract<BillingEvent, { subscription: NormalizedSubscription }> =>
  event.kind === 'subscription.activated' ||
  event.kind === 'subscription.updated' ||
  event.kind === 'subscription.canceled' ||
  event.kind === 'subscription.trial-will-end';

export const isInvoiceEvent = (
  event: BillingEvent,
): event is Extract<BillingEvent, { invoice: NormalizedInvoice }> =>
  event.kind === 'invoice.finalized' ||
  event.kind === 'invoice.paid' ||
  event.kind === 'invoice.payment-failed';

export const isPaymentMethodEvent = (
  event: BillingEvent,
): event is Extract<BillingEvent, { paymentMethod: NormalizedPaymentMethod }> =>
  event.kind === 'payment-method.attached' ||
  event.kind === 'payment-method.detached' ||
  event.kind === 'payment-method.updated';
