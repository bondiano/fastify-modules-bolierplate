import { describe, expect, it } from 'vitest';

import type { BillingEvent } from '../events.js';

import { createDevMemoryProvider } from './dev-memory.js';

describe('createDevMemoryProvider', () => {
  it('captures createCustomer + createCheckoutSession calls', async () => {
    const provider = createDevMemoryProvider();
    const customer = await provider.createCustomer({
      email: 'a@example.com',
      name: 'Alex',
      tenantId: 't-1',
    });
    expect(customer.providerCustomerId).toMatch(/^cus-/);
    const session = await provider.createCheckoutSession({
      providerCustomerId: customer.providerCustomerId,
      priceId: 'price-1',
      providerPriceId: 'price_local',
      successUrl: 'https://app.example/ok',
      cancelUrl: 'https://app.example/cancel',
      mode: 'subscription',
    });
    expect(session.sessionId).toMatch(/^cs-/);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].kind).toBe('createCustomer');
    expect(provider.calls[1].kind).toBe('createCheckoutSession');
  });

  it('queues + drains webhook events', () => {
    const provider = createDevMemoryProvider();
    const event: BillingEvent = {
      kind: 'invoice.paid',
      invoice: {
        providerInvoiceId: 'in_1',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: null,
        amountCents: 1000,
        currency: 'usd',
        status: 'paid',
        hostedUrl: null,
        pdfUrl: null,
        issuedAt: new Date(),
        paidAt: new Date(),
      },
      receivedAt: new Date(),
    };
    provider.queueEvent(event);
    const events = provider.verifyWebhook({
      headers: {},
      rawBody: Buffer.from(''),
    });
    expect(events).toEqual([event]);
    // Subsequent calls drain to empty.
    expect(
      provider.verifyWebhook({ headers: {}, rawBody: Buffer.from('') }),
    ).toEqual([]);
  });

  it('reset clears calls + queued events + counter', async () => {
    const provider = createDevMemoryProvider();
    await provider.createCustomer({
      email: 'a@example.com',
      name: 'A',
      tenantId: 't-1',
    });
    provider.queueEvent({
      kind: 'dispute.created',
      chargeId: 'ch_1',
      providerInvoiceId: null,
      amountCents: 0,
      currency: 'usd',
      receivedAt: new Date(),
    });
    provider.reset();
    expect(provider.calls).toHaveLength(0);
    const next = await provider.createCustomer({
      email: 'b@example.com',
      name: 'B',
      tenantId: 't-2',
    });
    // Counter reset means we get cus-1 again.
    expect(next.providerCustomerId).toBe('cus-1');
  });
});
