import { describe, expect, it } from 'vitest';

import {
  isInvoiceEvent,
  isPaymentMethodEvent,
  isSubscriptionEvent,
  type BillingEvent,
  type NormalizedInvoice,
  type NormalizedPaymentMethod,
  type NormalizedSubscription,
} from './events.js';

const baseSubscription: NormalizedSubscription = {
  providerSubscriptionId: 'sub_1',
  providerCustomerId: 'cus_1',
  providerPriceId: 'price_1',
  status: 'active',
  currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
  cancelAt: null,
  canceledAt: null,
  trialEnd: null,
  metadata: {},
};

const baseInvoice: NormalizedInvoice = {
  providerInvoiceId: 'in_1',
  providerCustomerId: 'cus_1',
  providerSubscriptionId: 'sub_1',
  amountCents: 4900,
  currency: 'usd',
  status: 'paid',
  hostedUrl: 'https://invoice.example/in_1',
  pdfUrl: 'https://invoice.example/in_1.pdf',
  issuedAt: new Date('2026-05-01T00:00:00Z'),
  paidAt: new Date('2026-05-01T01:00:00Z'),
};

const basePaymentMethod: NormalizedPaymentMethod = {
  providerPaymentMethodId: 'pm_1',
  providerCustomerId: 'cus_1',
  type: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  isDefault: true,
};

describe('billing event guards', () => {
  it('isSubscriptionEvent matches subscription kinds', () => {
    const events: BillingEvent[] = [
      {
        kind: 'subscription.activated',
        subscription: baseSubscription,
        receivedAt: new Date(),
      },
      {
        kind: 'subscription.updated',
        subscription: baseSubscription,
        receivedAt: new Date(),
      },
      {
        kind: 'subscription.canceled',
        subscription: baseSubscription,
        receivedAt: new Date(),
      },
      {
        kind: 'subscription.trial-will-end',
        subscription: baseSubscription,
        receivedAt: new Date(),
      },
    ];
    for (const event of events) {
      expect(isSubscriptionEvent(event)).toBe(true);
    }
  });

  it('isSubscriptionEvent rejects non-subscription kinds', () => {
    const event: BillingEvent = {
      kind: 'invoice.paid',
      invoice: baseInvoice,
      receivedAt: new Date(),
    };
    expect(isSubscriptionEvent(event)).toBe(false);
  });

  it('isInvoiceEvent matches invoice kinds', () => {
    const kinds: BillingEvent['kind'][] = [
      'invoice.finalized',
      'invoice.paid',
      'invoice.payment-failed',
    ];
    for (const kind of kinds) {
      const event = {
        kind,
        invoice: baseInvoice,
        receivedAt: new Date(),
      } as BillingEvent;
      expect(isInvoiceEvent(event)).toBe(true);
    }
  });

  it('isPaymentMethodEvent matches payment-method kinds', () => {
    const kinds: BillingEvent['kind'][] = [
      'payment-method.attached',
      'payment-method.updated',
      'payment-method.detached',
    ];
    for (const kind of kinds) {
      const event = {
        kind,
        paymentMethod: basePaymentMethod,
        receivedAt: new Date(),
      } as BillingEvent;
      expect(isPaymentMethodEvent(event)).toBe(true);
    }
  });

  it('checkout.completed and dispute.created are not subscription/invoice/pm events', () => {
    const checkout: BillingEvent = {
      kind: 'checkout.completed',
      sessionId: 'cs_1',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: null,
      receivedAt: new Date(),
    };
    const dispute: BillingEvent = {
      kind: 'dispute.created',
      chargeId: 'ch_1',
      providerInvoiceId: null,
      amountCents: 1000,
      currency: 'usd',
      receivedAt: new Date(),
    };
    expect(isSubscriptionEvent(checkout)).toBe(false);
    expect(isInvoiceEvent(checkout)).toBe(false);
    expect(isPaymentMethodEvent(checkout)).toBe(false);
    expect(isSubscriptionEvent(dispute)).toBe(false);
    expect(isInvoiceEvent(dispute)).toBe(false);
    expect(isPaymentMethodEvent(dispute)).toBe(false);
  });
});
