import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('billing_customers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    // Provider name (e.g. `'stripe'`). Kept as a free-form text so a
    // future Paddle/LS adapter is a no-migration addition.
    .addColumn('provider', 'text', (col) => col.notNull())
    // Provider-supplied customer id (e.g. `cus_...` for Stripe).
    .addColumn('provider_customer_id', 'text', (col) => col.notNull())
    // Snapshot of the email used at create time. Refreshed on
    // `customer.updated` webhook.
    .addColumn('email', 'text')
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // One billing customer row per (tenant, provider). Soft-deleted rows
  // count too -- if someone resurrects a tenant the prior customer id
  // is canonical until reactivation rebuilds it.
  await sql`
    CREATE UNIQUE INDEX billing_customers_tenant_provider_uniq
      ON billing_customers (tenant_id, provider)
      WHERE deleted_at IS NULL
  `.execute(db);

  // Webhook lookup: incoming `customer.updated` arrives with the
  // provider customer id only; we map back to (tenant_id, provider).
  await sql`
    CREATE UNIQUE INDEX billing_customers_provider_customer_uniq
      ON billing_customers (provider, provider_customer_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('billing_customers').execute();
}
