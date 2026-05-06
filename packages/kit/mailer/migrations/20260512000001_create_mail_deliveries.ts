import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('mail_deliveries')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Caller-supplied business idempotency key. The mailer's
    // `enqueue(...)` method does ON CONFLICT (idempotency_key) DO UPDATE
    // SET updated_at = now() RETURNING id, so duplicate enqueues from
    // retries or replays never produce duplicate sends.
    .addColumn('idempotency_key', 'text', (col) => col.notNull().unique())
    // FK -> tenants.id ON DELETE SET NULL: a hard tenant DELETE keeps
    // the delivery row for forensic queries. NULL is also valid for
    // pre-tenant flows (signup confirmation, password reset request).
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('set null'),
    )
    // FK -> users.id ON DELETE SET NULL. NULL when the recipient is a
    // not-yet-registered email (e.g. invitation to a new user).
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('template', 'text', (col) => col.notNull())
    .addColumn('template_version', 'text', (col) =>
      col.notNull().defaultTo('v1'),
    )
    .addColumn('locale', 'text', (col) => col.notNull().defaultTo('en'))
    .addColumn('to_address', 'text', (col) => col.notNull())
    .addColumn('from_address', 'text', (col) => col.notNull())
    .addColumn('reply_to', 'text')
    .addColumn('subject', 'text', (col) => col.notNull())
    // Template inputs (NOT rendered HTML). Rendered HTML is reproducible
    // from `(template, template_version, locale, payload)`. Storing the
    // HTML in jsonb would bloat this table fast (50KB email * 1M rows =
    // 50GB).
    .addColumn('payload', 'jsonb')
    .addColumn('provider', 'text')
    .addColumn('provider_message_id', 'text')
    // Status enum stored as text (Postgres enums are friction in
    // migrations -- a CHECK constraint here gives the same guarantee
    // without the alter-type ceremony).
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('queued')
        .check(
          sql`status IN ('queued', 'sending', 'sent', 'bounced', 'complained', 'failed', 'suppressed')`,
        ),
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error_code', 'text')
    .addColumn('last_error_message', 'text')
    .addColumn('correlation_id', 'text')
    .addColumn('tags', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`),
    )
    .addColumn('scheduled_for', 'timestamptz')
    .addColumn('queued_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('sent_at', 'timestamptz')
    .addColumn('bounced_at', 'timestamptz')
    .addColumn('complained_at', 'timestamptz')
    .addColumn('opened_at', 'timestamptz')
    .addColumn('clicked_at', 'timestamptz')
    .addColumn('failed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Admin filter: list a tenant's deliveries newest-first by status.
  await sql`
    CREATE INDEX idx_mail_deliveries_tenant_status_queued
      ON mail_deliveries (tenant_id, status, queued_at DESC)
  `.execute(db);

  // Webhook ingestion seeks rows by provider_message_id when a bounce /
  // delivery / open event arrives. Partial because most rows haven't
  // yet been dispatched (provider_message_id IS NULL).
  await sql`
    CREATE INDEX idx_mail_deliveries_provider_message
      ON mail_deliveries (provider_message_id)
      WHERE provider_message_id IS NOT NULL
  `.execute(db);

  // Recipient drill-down: "show every email we tried to send to
  // foo@bar.com". Useful for support tickets.
  await sql`
    CREATE INDEX idx_mail_deliveries_to_address_queued
      ON mail_deliveries (to_address, queued_at DESC)
  `.execute(db);

  // Sweep job seek: find rows stuck at 'queued' or future-scheduled.
  // Partial keeps the index small (only ~hundreds of rows in flight at
  // any moment).
  await sql`
    CREATE INDEX idx_mail_deliveries_pending
      ON mail_deliveries (queued_at)
      WHERE status = 'queued'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('mail_deliveries').execute();
}
