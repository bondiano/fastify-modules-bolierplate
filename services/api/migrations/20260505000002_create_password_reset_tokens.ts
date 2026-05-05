import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('password_reset_tokens')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    // Hashes only -- raw token never persisted (mirrors @kit/tenancy's
    // invitation token pattern). Unique so a token can be redeemed at most once.
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Pending tokens by user (skip-the-table when there's nothing live for
  // a user). Partial.
  await sql`
    CREATE INDEX idx_password_reset_tokens_user_active
      ON password_reset_tokens (user_id)
      WHERE used_at IS NULL
  `.execute(db);

  // Cleanup sweep seek index.
  await db.schema
    .createIndex('idx_password_reset_tokens_expires_at')
    .on('password_reset_tokens')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('password_reset_tokens').execute();
}
