/**
 * Weekly stuck-invoice reconciliation. For every local invoice in
 * `'open'` state older than 7 days, re-fetch from the provider via
 * `provider.listInvoices(customerId, { status: 'open' })` and emit a
 * synthetic event through the same `dispatchEvent` path the webhook
 * worker uses. Catches the rare case where `invoice.paid` was missed
 * past Stripe's 3-day retry window.
 *
 * Scheduled at 03:00 UTC every Sunday.
 */
import type { DB } from '#db/schema.ts';
import type {
  BillingProvider,
  InvoicesRepository,
  NormalizedInvoice,
} from '@kit/billing';
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'billing.reconcile-invoices': undefined;
  }
}

interface ReconcileCradle {
  billingProvider: BillingProvider;
  invoicesRepository: InvoicesRepository<DB>;
  billingCustomersRepository: {
    findById(id: string): Promise<{ providerCustomerId: string } | null>;
  };
  billingWebhookEventsRepository: {
    append(entry: {
      provider: string;
      provider_event_id: string;
      type: string;
      payload: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
  queues: {
    billing: {
      add(
        name: 'billing.process-event',
        data: { eventId: string },
        opts?: { jobId?: string },
      ): Promise<unknown>;
    };
  };
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

const dateKey = (d: Date): string =>
  d.toISOString().slice(0, 10).replaceAll('-', '');

const invoiceToPayload = (inv: NormalizedInvoice): Record<string, unknown> => ({
  type: 'invoice.paid',
  data: {
    object: {
      id: inv.providerInvoiceId,
      customer: inv.providerCustomerId,
      subscription: inv.providerSubscriptionId,
      amount_due: inv.amountCents,
      currency: inv.currency,
      status: inv.status,
      hosted_invoice_url: inv.hostedUrl,
      invoice_pdf: inv.pdfUrl,
      created: Math.floor(inv.issuedAt.getTime() / 1000),
      status_transitions: {
        paid_at: inv.paidAt ? Math.floor(inv.paidAt.getTime() / 1000) : null,
      },
    },
  },
});

export default createJob<undefined>(
  'billing.reconcile-invoices',
  async (fastify) => {
    const cradle = fastify.diContainer.cradle as unknown as ReconcileCradle;
    const stuck = await cradle.invoicesRepository.findStuckOpen({
      olderThanMs: SEVEN_DAYS_MS,
      limit: 200,
    });
    const today = dateKey(new Date());
    const seenCustomers = new Set<string>();

    for (const invoice of stuck) {
      const customer = await cradle.billingCustomersRepository.findById(
        invoice.billingCustomerId,
      );
      if (!customer) continue;
      if (seenCustomers.has(customer.providerCustomerId)) continue;
      seenCustomers.add(customer.providerCustomerId);

      const refreshed = await cradle.billingProvider.listInvoices(
        customer.providerCustomerId,
        { status: 'open', limit: 50 },
      );

      for (const inv of refreshed) {
        if (inv.status === 'open') continue;
        const reconEventId = `recon-inv:${inv.providerInvoiceId}:${today}`;
        const inserted = await cradle.billingWebhookEventsRepository.append({
          provider: cradle.billingProvider.name,
          provider_event_id: reconEventId,
          type: 'reconcile.invoice',
          payload: invoiceToPayload(inv),
        });
        if (inserted) {
          await cradle.queues.billing.add(
            'billing.process-event',
            { eventId: inserted.id },
            {
              jobId: `billing-event:${cradle.billingProvider.name}:${reconEventId}`,
            },
          );
        }
      }
    }
  },
  {
    workerConfig: { concurrency: 1 },
    repeat: { pattern: '0 3 * * 0' },
  },
);
