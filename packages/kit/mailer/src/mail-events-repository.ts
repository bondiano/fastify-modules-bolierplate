/**
 * Webhook event ledger. The receiver routes (`/webhooks/mail/{ses,
 * postmark,resend}`) verify the provider signature, persist the raw
 * payload here, ACK 200 immediately, then enqueue `mail.process-event`
 * to update `mail_deliveries` + suppression list.
 *
 * Idempotent ingestion: `(provider, event_id)` UNIQUE rejects duplicate
 * deliveries from the provider's retry mechanism. We use ON CONFLICT
 * DO NOTHING so the receiver still ACKs 200 on the second attempt.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';

import type { MailEventsTable, MailerDB } from './schema.js';

export type MailEventInsert = Insertable<MailEventsTable>;
export type MailEventRow = Selectable<MailEventsTable>;

export interface MailEventsRepository {
  /** Persist a webhook event. Returns `null` when a duplicate (by
   * `(provider, event_id)`) was absorbed -- caller ACKs 200 anyway but
   * skips enqueueing the processor job. */
  append(entry: MailEventInsert): Promise<MailEventRow | null>;

  findByEventId(
    provider: string,
    eventId: string,
  ): Promise<MailEventRow | null>;
  findById(id: string): Promise<MailEventRow | null>;

  /** Mark the event as processed by the `mail.process-event` job.
   * Idempotent: if `processed_at` was already set, leaves it. */
  markProcessed(id: string): Promise<void>;

  /** Reads up to `limit` unprocessed events ordered by arrival. Used
   * for forensic re-processing if the normaliser changes. */
  findUnprocessed(limit: number): Promise<readonly MailEventRow[]>;
}

export interface MailEventsRepositoryDeps<DB extends MailerDB> {
  readonly transaction: Trx<DB>;
}

export const createMailEventsRepository = <DB extends MailerDB>({
  transaction,
}: MailEventsRepositoryDeps<DB>): MailEventsRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    async append(entry) {
      const result = await trx
        .insertInto('mail_events')
        .values(entry)
        .onConflict(
          (oc: { columns: (cols: string[]) => { doNothing: () => unknown } }) =>
            oc.columns(['provider', 'event_id']).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();
      return result ?? null;
    },

    async findByEventId(provider, eventId) {
      return (
        (await trx
          .selectFrom('mail_events')
          .selectAll()
          .where('provider', '=', provider)
          .where('event_id', '=', eventId)
          .executeTakeFirst()) ?? null
      );
    },

    async findById(id) {
      return (
        (await trx
          .selectFrom('mail_events')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) ?? null
      );
    },

    async markProcessed(id) {
      await trx
        .updateTable('mail_events')
        .set({ processed_at: new Date().toISOString() })
        .where('id', '=', id)
        .where('processed_at', 'is', null)
        .execute();
    },

    async findUnprocessed(limit) {
      return await trx
        .selectFrom('mail_events')
        .selectAll()
        .where('processed_at', 'is', null)
        .orderBy('received_at', 'asc')
        .limit(limit)
        .execute();
    },
  };
};
