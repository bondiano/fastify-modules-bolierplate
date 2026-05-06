import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // -------- invoices --------
  await db.schema
    .createTable('invoices')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    // Subscription FK is SET NULL: one-off invoices (metered overage,
    // manual charges) aren't tied to a subscription. The pair (tenant_id,
    // billing_customer_id) is always populated.
    .addColumn('subscription_id', 'uuid', (col) =>
      col.references('subscriptions.id').onDelete('set null'),
    )
    .addColumn('billing_customer_id', 'uuid', (col) =>
      col.notNull().references('billing_customers.id').onDelete('cascade'),
    )
    .addColumn('provider_invoice_id', 'text', (col) => col.notNull().unique())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('currency', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`status IN ('draft', 'open', 'paid', 'uncollectible', 'void')`,
        ),
    )
    .addColumn('hosted_url', 'text')
    .addColumn('pdf_url', 'text')
    .addColumn('issued_at', 'timestamptz', (col) => col.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Admin list: tenant invoices newest-first.
  await sql`
    CREATE INDEX idx_invoices_tenant_status_issued_at
      ON invoices (tenant_id, status, issued_at DESC)
  `.execute(db);

  // Stuck-invoice reconciliation: "open invoices older than 7 days".
  // Partial keeps the index small (only ~hundreds of rows in flight).
  await sql`
    CREATE INDEX idx_invoices_stuck_open
      ON invoices (issued_at)
      WHERE status = 'open'
  `.execute(db);

  // -------- payment_methods --------
  await db.schema
    .createTable('payment_methods')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    .addColumn('billing_customer_id', 'uuid', (col) =>
      col.notNull().references('billing_customers.id').onDelete('cascade'),
    )
    .addColumn('provider_payment_method_id', 'text', (col) =>
      col.notNull().unique(),
    )
    // `'card'`, `'us_bank_account'`, ...
    .addColumn('type', 'text', (col) => col.notNull())
    // Card-only fields. Brand/last4 are PII-adjacent; the audit_log
    // emitter scrubs them via sensitiveColumns: ['brand', 'last4'].
    .addColumn('brand', 'text')
    .addColumn('last4', 'text')
    .addColumn('exp_month', 'integer')
    .addColumn('exp_year', 'integer')
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // Default payment method per (tenant, billing_customer) is unique
  // among non-deleted rows.
  await sql`
    CREATE UNIQUE INDEX payment_methods_tenant_default_uniq
      ON payment_methods (tenant_id, billing_customer_id)
      WHERE is_default = true AND deleted_at IS NULL
  `.execute(db);

  // -------- billing_webhook_events --------
  // Idempotent ledger. Mirrors `mail_events` exactly: ON CONFLICT
  // (provider, provider_event_id) DO NOTHING absorbs Stripe's
  // at-least-once delivery.
  await db.schema
    .createTable('billing_webhook_events')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    // Provider-supplied unique event id (e.g. `evt_...` for Stripe).
    .addColumn('provider_event_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('processed_at', 'timestamptz')
    .addColumn('error', 'text')
    .execute();

  // The dedup key. ON CONFLICT (provider, provider_event_id) DO NOTHING.
  await sql`
    CREATE UNIQUE INDEX billing_webhook_events_provider_event_id_uniq
      ON billing_webhook_events (provider, provider_event_id)
  `.execute(db);

  // Process-stuck seek: rows whose worker run failed and need to be
  // re-enqueued. Partial keeps the index tight.
  await sql`
    CREATE INDEX idx_billing_webhook_events_unprocessed
      ON billing_webhook_events (received_at)
      WHERE processed_at IS NULL
  `.execute(db);

  // Prune seek: rows older than the retention window (30d).
  await sql`
    CREATE INDEX idx_billing_webhook_events_received_at
      ON billing_webhook_events (received_at)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('billing_webhook_events').execute();
  await db.schema.dropTable('payment_methods').execute();
  await db.schema.dropTable('invoices').execute();
}
