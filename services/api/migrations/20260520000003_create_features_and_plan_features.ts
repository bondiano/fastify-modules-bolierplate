import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Feature catalog. The PK is the feature key (`'export-csv'`,
  // `'api-rate-limit'`, ...) so callers can `isFeatureEnabled('export-csv',
  // tenant)` without a join.
  await db.schema
    .createTable('features')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    // boolean: { enabled: true|false } -- on/off feature
    // limit:   { limit: 10 } -- numeric ceiling enforced by app code
    // quota:   { quotaPerMonth: 100000 } -- metered usage reset monthly
    .addColumn('type', 'text', (col) =>
      col.notNull().check(sql`type IN ('boolean', 'limit', 'quota')`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // plan_features is a wide-style join table. The composite PK
  // (plan_id, feature_key) replaces a synthetic id -- there's only one
  // value per (plan, feature) combo so a surrogate key adds no value.
  await db.schema
    .createTable('plan_features')
    .addColumn('plan_id', 'uuid', (col) =>
      col.notNull().references('plans.id').onDelete('cascade'),
    )
    .addColumn('feature_key', 'text', (col) =>
      col.notNull().references('features.key').onDelete('cascade'),
    )
    // Feature value as jsonb so a single column carries every type:
    //   `{ enabled: true }`     -- boolean
    //   `{ limit: 10 }`          -- limit
    //   `{ quotaPerMonth: 100000 }` -- quota
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('plan_features_pk', ['plan_id', 'feature_key'])
    .execute();

  // Reverse lookup: "which plans grant feature X?".
  await sql`
    CREATE INDEX idx_plan_features_feature_key
      ON plan_features (feature_key)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('plan_features').execute();
  await db.schema.dropTable('features').execute();
}
