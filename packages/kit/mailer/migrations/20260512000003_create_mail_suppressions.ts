import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('mail_suppressions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // FK -> tenants.id ON DELETE CASCADE -- a tenant's suppression list
    // doesn't outlive the tenant. NULL = global suppression (rare;
    // usually populated only by manual admin action when a complaint
    // arrives before tenant resolution).
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('cascade'),
    )
    // Lower-cased recipient. We never look up by mixed case so storing
    // the canonical form keeps the unique index tight.
    .addColumn('email_lower', 'text', (col) => col.notNull())
    .addColumn('reason', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`reason IN ('hard_bounce', 'complaint', 'unsubscribe', 'manual')`,
        ),
    )
    // Free-form provenance: 'webhook:resend', 'webhook:postmark',
    // 'manual:admin@example.com', 'import:csv-2026-05-01'. Useful for
    // explaining "why is this address blocked?" in support.
    .addColumn('source', 'text', (col) => col.notNull())
    // NULL = permanent (hard bounces / complaints, per CAN-SPAM
    // §5(a)(4) which requires opt-out honored indefinitely until
    // re-consent). Set an expiry only on `manual` rows that should
    // auto-clear -- e.g. a temporary block during incident response.
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // One row per (tenant, email) pair. tenant_id IS NULL collapses to
  // global suppressions; we still want one row each. We need two
  // indexes to enforce uniqueness in both shapes (PG doesn't treat
  // NULL = NULL in UNIQUE).
  await sql`
    CREATE UNIQUE INDEX uq_mail_suppressions_tenant_email
      ON mail_suppressions (tenant_id, email_lower)
      WHERE tenant_id IS NOT NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_mail_suppressions_global_email
      ON mail_suppressions (email_lower)
      WHERE tenant_id IS NULL
  `.execute(db);

  // Pre-send lookup: worker checks "is this address suppressed for the
  // current tenant?". Indexed by email first because the tenant fanout
  // is narrow (one tenant per send).
  await sql`
    CREATE INDEX idx_mail_suppressions_email_tenant
      ON mail_suppressions (email_lower, tenant_id)
  `.execute(db);

  // Cleanup sweep for `manual` rows with an expires_at.
  await sql`
    CREATE INDEX idx_mail_suppressions_expires_at
      ON mail_suppressions (expires_at)
      WHERE expires_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('mail_suppressions').execute();
}
