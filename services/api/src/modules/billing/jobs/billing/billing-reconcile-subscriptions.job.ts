/**
 * Nightly subscription reconciliation. Mirrors `mail-sweep.job.ts`
 * (cron via `repeat: { pattern }`).
 *
 * Walks every active / trialing / past_due subscription on the provider
 * side, diffs against local rows, and emits a synthetic `BillingEvent`
 * for any drift through the same `dispatchEvent` path the webhook
 * worker uses. Idempotency comes from the `billing_webhook_events`
 * ledger: synthetic event id `recon-sub:${subId}:${YYYYMMDD}` so a
 * second run on the same day is a no-op.
 *
 * Scheduled at 03:00 UTC daily.
 */
import type { BillingProvider, NormalizedSubscription } from '@kit/billing';
import { createJob } from '@kit/jobs';

declare module '@kit/jobs' {
  interface Jobs {
    'billing.reconcile-subscriptions': undefined;
  }
}

interface ReconcileCradle {
  billingProvider: BillingProvider;
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

const dateKey = (d: Date): string =>
  d.toISOString().slice(0, 10).replaceAll('-', '');

const subscriptionToPayload = (
  sub: NormalizedSubscription,
): Record<string, unknown> => ({
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: sub.providerSubscriptionId,
      customer: sub.providerCustomerId,
      status: sub.status,
      current_period_start: Math.floor(sub.currentPeriodStart.getTime() / 1000),
      current_period_end: Math.floor(sub.currentPeriodEnd.getTime() / 1000),
      cancel_at: sub.cancelAt
        ? Math.floor(sub.cancelAt.getTime() / 1000)
        : null,
      canceled_at: sub.canceledAt
        ? Math.floor(sub.canceledAt.getTime() / 1000)
        : null,
      trial_end: sub.trialEnd
        ? Math.floor(sub.trialEnd.getTime() / 1000)
        : null,
      metadata: sub.metadata,
      items: { data: [{ price: { id: sub.providerPriceId } }] },
    },
  },
});

export default createJob<undefined>(
  'billing.reconcile-subscriptions',
  async (fastify) => {
    const cradle = fastify.diContainer.cradle as unknown as ReconcileCradle;
    const provider = cradle.billingProvider;
    const today = dateKey(new Date());

    for (const status of ['active', 'past_due', 'trialing'] as const) {
      for await (const sub of provider.listSubscriptions({ status })) {
        const reconEventId = `recon-sub:${sub.providerSubscriptionId}:${today}`;
        const inserted = await cradle.billingWebhookEventsRepository.append({
          provider: provider.name,
          provider_event_id: reconEventId,
          type: 'reconcile.subscription',
          payload: subscriptionToPayload(sub),
        });
        if (inserted) {
          await cradle.queues.billing.add(
            'billing.process-event',
            { eventId: inserted.id },
            { jobId: `billing-event:${provider.name}:${reconEventId}` },
          );
        }
      }
    }
  },
  {
    workerConfig: { concurrency: 1 },
    repeat: { pattern: '0 3 * * *' },
  },
);
