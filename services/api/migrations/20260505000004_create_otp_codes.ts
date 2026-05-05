import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('otp_codes')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    // Free-form purpose tag, e.g. 'mfa-challenge'. Bounded length keeps
    // the index small and lets services partition usage cleanly.
    .addColumn('purpose', 'varchar(64)', (col) => col.notNull())
    .addColumn('code_hash', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    CREATE INDEX idx_otp_codes_user_purpose_active
      ON otp_codes (user_id, purpose)
      WHERE used_at IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_otp_codes_expires_at')
    .on('otp_codes')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('otp_codes').execute();
}
