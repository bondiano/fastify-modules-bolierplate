import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_identities')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    // CHECK reserves room for `apple` + `microsoft` even though v1
    // only ships Google + GitHub. Adding those later is a one-file
    // change instead of a migration.
    .addColumn('provider', 'text', (col) =>
      col
        .notNull()
        .check(sql`provider IN ('google', 'github', 'apple', 'microsoft')`),
    )
    // Provider-supplied stable user id. NOT email -- Apple's `sub`,
    // Google's `sub`, GitHub's numeric `id`. Stable across email
    // changes / username changes.
    .addColumn('provider_user_id', 'text', (col) => col.notNull())
    // Snapshot of the email at link time. Apple omits this on
    // re-grants, so the column is nullable.
    .addColumn('email', 'text')
    .addColumn('email_verified', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('raw_profile', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // The natural key. provider_user_id is stable across email rotations,
  // so we anchor uniqueness here -- not on (provider, email).
  await sql`
    CREATE UNIQUE INDEX user_identities_provider_provider_user_id_uniq
      ON user_identities (provider, provider_user_id)
  `.execute(db);

  // One identity per provider per user. Prevents accidentally linking
  // two Google accounts to the same local user via a race.
  await sql`
    CREATE UNIQUE INDEX user_identities_user_provider_uniq
      ON user_identities (user_id, provider)
  `.execute(db);

  // Email collision lookup: "is bondi@example.com already linked under
  // any provider for any user?". Lower-cased for case-insensitive matching.
  await sql`
    CREATE INDEX user_identities_provider_email_idx
      ON user_identities (provider, lower(email))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_identities').execute();
}
