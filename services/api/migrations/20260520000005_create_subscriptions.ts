import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('subscriptions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    .addColumn('billing_customer_id', 'uuid', (col) =>
      col.notNull().references('billing_customers.id').onDelete('cascade'),
    )
    // Plan FK is SET NULL: when a plan is retired/migrated, existing
    // subscriptions keep working until the next provider event lands a
    // replacement plan_id.
    .addColumn('plan_id', 'uuid', (col) =>
      col.references('plans.id').onDelete('set null'),
    )
    // Provider subscription id (e.g. `sub_...` for Stripe). UNIQUE
    // because the webhook handler looks up local rows by it.
    .addColumn('provider_subscription_id', 'text', (col) =>
      col.notNull().unique(),
    )
    // Status enum stored as text + CHECK -- same convention as
    // mail_deliveries.status. Avoids Postgres enum migration friction.
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid')`,
        ),
    )
    .addColumn('current_period_start', 'timestamptz', (col) => col.notNull())
    .addColumn('current_period_end', 'timestamptz', (col) => col.notNull())
    .addColumn('cancel_at', 'timestamptz')
    .addColumn('canceled_at', 'timestamptz')
    .addColumn('trial_end', 'timestamptz')
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Tenant dashboard / admin list: "show this tenant's active subs".
  await sql`
    CREATE INDEX idx_subscriptions_tenant_status
      ON subscriptions (tenant_id, status, current_period_end DESC)
  `.execute(db);

  // Reconciliation seek: "list every active subscription for nightly
  // diff against provider state".
  await sql`
    CREATE INDEX idx_subscriptions_active_period_end
      ON subscriptions (current_period_end)
      WHERE status IN ('active', 'trialing', 'past_due')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('subscriptions').execute();
}
