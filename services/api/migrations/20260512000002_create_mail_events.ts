import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('mail_events')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    // Provider-supplied unique event id. The webhook handler does ON
    // CONFLICT DO NOTHING on (provider, event_id) so duplicate webhook
    // deliveries from a flaky provider never produce double-processing.
    .addColumn('event_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    // Best-effort link back to the matching delivery row. Populated by
    // the `mail.process-event` job after parsing the payload. NULL when
    // the event arrives before the delivery row is in our DB (rare but
    // possible with very fast providers + slow disk).
    .addColumn('provider_message_id', 'text')
    // Whole raw payload as we received it -- needed for forensic
    // analysis and for re-processing if the normaliser changes.
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('occurred_at', 'timestamptz', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('processed_at', 'timestamptz')
    .execute();

  // Idempotent ingestion: per-provider event id is unique.
  await sql`
    CREATE UNIQUE INDEX uq_mail_events_provider_event
      ON mail_events (provider, event_id)
  `.execute(db);

  // The processor picks unprocessed rows in arrival order. Partial keeps
  // the index small once events have been processed.
  await sql`
    CREATE INDEX idx_mail_events_unprocessed
      ON mail_events (received_at)
      WHERE processed_at IS NULL
  `.execute(db);

  // Provider-message reverse lookup -- handy when investigating a
  // specific delivery's event timeline.
  await sql`
    CREATE INDEX idx_mail_events_provider_message
      ON mail_events (provider_message_id)
      WHERE provider_message_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('mail_events').execute();
}
