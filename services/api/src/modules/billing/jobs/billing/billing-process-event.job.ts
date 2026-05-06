/**
 * Webhook event processor. The webhook receiver
 * (`services/api/src/modules/billing/webhooks.route.ts`) persisted the
 * raw event in `billing_webhook_events` and ACKed 200 immediately.
 * This job runs async and:
 *
 * 1. Reads the row from `billing_webhook_events`.
 * 2. Re-verifies the signature via the active `billingProvider.verifyWebhook`
 *    to extract the normalized `BillingEvent[]` (the receiver's verify
 *    result is not stored -- only the raw payload is).
 * 3. For each event, calls `billingService.dispatchEvent(...)` -- which
 *    pivots on `event.kind`, routes to the right repository mutator,
 *    invalidates the entitlements cache for subscription events, and
 *    returns a discriminated result.
 * 4. Emits an audit row tying the event to the affected subject.
 * 5. May enqueue a transactional mail (invoice receipt, trial-ending
 *    notice, etc) for selected event kinds.
 * 6. Marks `billing_webhook_events.processed_at`.
 *
 * The worker opens `tenantContext.withTenant(tenantId, ...)` before any
 * tenant-scoped repo call -- mirrors `mail-process-event.job.ts`.
 */
import type { Queue } from 'bullmq';

import type { BillingEvent, BillingProvider } from '@kit/billing';
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'billing.process-event': { eventId: string };
  }
  interface Queues {
    billing: Queue<Jobs['billing.process-event']>;
  }
}

interface WebhookEventRow {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly processedAt: Date | null;
}

interface MailerService {
  send<T extends string>(
    template: T,
    payload: Record<string, unknown>,
    opts: {
      idempotencyKey: string;
      to: string;
      tenantId: string | null;
    },
  ): Promise<unknown>;
}

interface ProcessEventCradle {
  billingProvider: BillingProvider;
  billingWebhookEventsRepository: {
    findById(id: string): Promise<WebhookEventRow | null>;
    markProcessed(id: string): Promise<void>;
    markFailed(id: string, error: string): Promise<void>;
  };
  billingService: {
    dispatchEvent(event: BillingEvent): Promise<{
      readonly applied: string;
      readonly row?: { readonly id: string; readonly tenantId: string };
    }>;
  };
  auditLogRepository: {
    append(entry: {
      tenantId: string | null;
      actorId: null;
      subjectType: string;
      subjectId: string;
      action: string;
      metadata?: Record<string, unknown>;
      sensitive?: boolean;
    }): Promise<unknown>;
  };
  tenantContext: {
    withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  };
  mailerService?: MailerService;
}

const SUBJECT_TYPE_BY_KIND: Readonly<Record<string, string>> = {
  'subscription.activated': 'Subscription',
  'subscription.updated': 'Subscription',
  'subscription.canceled': 'Subscription',
  'subscription.trial-will-end': 'Subscription',
  'invoice.finalized': 'Invoice',
  'invoice.paid': 'Invoice',
  'invoice.payment-failed': 'Invoice',
  'payment-method.attached': 'PaymentMethod',
  'payment-method.detached': 'PaymentMethod',
  'payment-method.updated': 'PaymentMethod',
  'checkout.completed': 'Checkout',
  'dispute.created': 'Dispute',
};

const AUDIT_ACTION_BY_KIND: Readonly<Record<string, string>> = {
  'subscription.activated': 'billing.subscription-activated',
  'subscription.updated': 'billing.subscription-updated',
  'subscription.canceled': 'billing.subscription-canceled',
  'subscription.trial-will-end': 'billing.subscription-trial-will-end',
  'invoice.finalized': 'billing.invoice-finalized',
  'invoice.paid': 'billing.invoice-paid',
  'invoice.payment-failed': 'billing.invoice-payment-failed',
  'payment-method.attached': 'billing.payment-method-attached',
  'payment-method.detached': 'billing.payment-method-detached',
  'payment-method.updated': 'billing.payment-method-updated',
  'checkout.completed': 'billing.checkout-completed',
  'dispute.created': 'billing.dispute-created',
};

export default createJob<{ eventId: string }>(
  'billing.process-event',
  async (fastify, job) => {
    const cradle = fastify.diContainer.cradle as unknown as ProcessEventCradle;
    const eventRow = await cradle.billingWebhookEventsRepository.findById(
      job.data.eventId,
    );
    if (!eventRow || eventRow.processedAt !== null) {
      return;
    }

    // Re-extract the normalized event from the raw payload. The
    // adapter's verifier double-checks the signature (defence in depth)
    // and returns the same `BillingEvent` shape the receiver saw.
    const rawBuffer = Buffer.from(JSON.stringify(eventRow.payload));
    const events = cradle.billingProvider.verifyWebhook({
      headers: {},
      rawBody: rawBuffer,
    });
    if (events === null) {
      // Re-verify failed (e.g. webhook secret rotated since receipt).
      // Mark failed and skip retry -- the row stays for forensics.
      await cradle.billingWebhookEventsRepository.markFailed(
        eventRow.id,
        'verifyWebhook returned null on re-extraction',
      );
      return;
    }

    for (const event of events) {
      const result = await cradle.billingService.dispatchEvent(event);

      const tenantId = result.row?.tenantId ?? null;
      const subjectId =
        result.row?.id ?? `${eventRow.provider}:${eventRow.providerEventId}`;
      const subjectType = SUBJECT_TYPE_BY_KIND[event.kind] ?? 'BillingEvent';
      const action =
        AUDIT_ACTION_BY_KIND[event.kind] ?? `billing.${event.kind}`;
      const sensitive = event.kind.startsWith('payment-method.');

      const emit = async () => {
        await cradle.auditLogRepository.append({
          tenantId,
          actorId: null,
          subjectType,
          subjectId,
          action,
          metadata: {
            provider: eventRow.provider,
            providerEventId: eventRow.providerEventId,
            kind: event.kind,
          },
          sensitive,
        });
        // Mail enqueue is intentionally a follow-up: the worker emits
        // audit synchronously, but transactional mail (invoice receipts,
        // trial-ending notices) needs the customer's email -- enriched
        // via a `billingCustomersRepository.findById(...)` call once
        // 2d-mail wiring lands. Skipped for v1.
      };

      await (tenantId === null
        ? emit()
        : cradle.tenantContext.withTenant(tenantId, emit));
    }

    await cradle.billingWebhookEventsRepository.markProcessed(eventRow.id);
  },
  {
    workerConfig: { concurrency: 4 },
    queueConfig: {
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 7 * 86_400 },
      },
    },
  },
);
