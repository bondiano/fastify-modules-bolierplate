/**
 * Webhook event ledger. The receiver route (`/webhooks/billing/stripe`)
 * verifies the provider signature, persists the raw payload here, ACKs
 * 200 immediately, then enqueues `billing.process-event` to update
 * `subscriptions` / `invoices` / `payment_methods`.
 *
 * Idempotent ingestion: `(provider, provider_event_id)` UNIQUE rejects
 * duplicate deliveries from Stripe's at-least-once retry mechanism.
 * `ON CONFLICT DO NOTHING` so the receiver still ACKs 200 on the second
 * attempt without enqueueing a duplicate job.
 *
 * Mirrors `@kit/mailer/mail-events-repository.ts` exactly -- the only
 * differences are the table name and the natural-key column.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';

import type { BillingDB, BillingWebhookEventsTable } from './schema.js';

export type BillingWebhookEventInsert = Insertable<BillingWebhookEventsTable>;
export type BillingWebhookEventRow = Selectable<BillingWebhookEventsTable>;

export interface BillingWebhookEventsRepository {
  /** Persist a webhook event. Returns `null` when a duplicate (by
   * `(provider, provider_event_id)`) was absorbed -- caller ACKs 200
   * anyway but skips enqueueing the processor job. */
  append(
    entry: BillingWebhookEventInsert,
  ): Promise<BillingWebhookEventRow | null>;

  findByEventId(
    provider: string,
    providerEventId: string,
  ): Promise<BillingWebhookEventRow | null>;

  findById(id: string): Promise<BillingWebhookEventRow | null>;

  /** Mark the event as processed. Idempotent: if `processed_at` was
   * already set, leaves it. */
  markProcessed(id: string): Promise<void>;

  /** Mark the event as failed without consuming retry budget. The
   * worker calls this only on `BillingEventNormalizationFailed` -- a
   * payload that won't ever succeed however many times we retry. */
  markFailed(id: string, error: string): Promise<void>;

  /** Reads up to `limit` unprocessed events ordered by arrival. Used
   * for forensic re-processing if the normaliser changes. */
  findUnprocessed(limit: number): Promise<readonly BillingWebhookEventRow[]>;

  /** Prune rows older than `cutoff`. Returns the number of deleted rows.
   * Called by the daily `billing.prune` cron with `cutoff = now - 30d`. */
  pruneOlderThan(cutoff: Date): Promise<number>;
}

export interface BillingWebhookEventsRepositoryDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
}

export const createBillingWebhookEventsRepository = <DB extends BillingDB>({
  transaction,
}: BillingWebhookEventsRepositoryDeps<DB>): BillingWebhookEventsRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    async append(entry) {
      const result = await trx
        .insertInto('billing_webhook_events')
        .values(entry)
        .onConflict(
          (oc: { columns: (cols: string[]) => { doNothing: () => unknown } }) =>
            oc.columns(['provider', 'provider_event_id']).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();
      return result ?? null;
    },

    async findByEventId(provider, providerEventId) {
      return (
        (await trx
          .selectFrom('billing_webhook_events')
          .selectAll()
          .where('provider', '=', provider)
          .where('provider_event_id', '=', providerEventId)
          .executeTakeFirst()) ?? null
      );
    },

    async findById(id) {
      return (
        (await trx
          .selectFrom('billing_webhook_events')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) ?? null
      );
    },

    async markProcessed(id) {
      await trx
        .updateTable('billing_webhook_events')
        .set({ processed_at: new Date().toISOString(), error: null })
        .where('id', '=', id)
        .where('processed_at', 'is', null)
        .execute();
    },

    async markFailed(id, error) {
      await trx
        .updateTable('billing_webhook_events')
        .set({ error })
        .where('id', '=', id)
        .execute();
    },

    async findUnprocessed(limit) {
      return await trx
        .selectFrom('billing_webhook_events')
        .selectAll()
        .where('processed_at', 'is', null)
        .orderBy('received_at', 'asc')
        .limit(limit)
        .execute();
    },

    async pruneOlderThan(cutoff) {
      const result = await trx
        .deleteFrom('billing_webhook_events')
        .where('received_at', '<', cutoff.toISOString())
        .executeTakeFirst();
      return Number(result?.numDeletedRows ?? 0);
    },
  };
};
