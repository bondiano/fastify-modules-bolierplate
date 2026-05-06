import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('prices')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('plan_id', 'uuid', (col) =>
      col.notNull().references('plans.id').onDelete('cascade'),
    )
    // Provider-supplied price id (e.g. `price_...` for Stripe). UNIQUE
    // because Stripe webhooks reference prices by this id; we look up
    // the local row by it.
    .addColumn('provider_price_id', 'text', (col) => col.notNull().unique())
    // ISO 4217 currency code; lowercase by convention to match Stripe's.
    .addColumn('currency', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    // Recurring (`month`/`year`) vs one-time charges. CHECK matches the
    // PriceInterval type in `@kit/billing/schema`.
    .addColumn('interval', 'text', (col) =>
      col.notNull().check(sql`interval IN ('month', 'year', 'one_time')`),
    )
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Plan -> active prices is the most common admin/dashboard query.
  await sql`
    CREATE INDEX idx_prices_plan_active
      ON prices (plan_id, is_active)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('prices').execute();
}
