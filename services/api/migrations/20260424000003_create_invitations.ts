import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('invitations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull())
    .addColumn('role', 'varchar(50)', (col) =>
      col.notNull().defaultTo('member'),
    )
    .addColumn('token_hash', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('invited_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // Partial index for the hot path: `findPendingByEmail` filters by
  // `(tenant_id, email)` AND `accepted_at IS NULL`. A partial index keeps
  // only pending rows, shrinking the index to a fraction of the table.
  await sql`
    CREATE INDEX idx_invitations_pending
      ON invitations (tenant_id, email)
      WHERE accepted_at IS NULL AND deleted_at IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_invitations_expires_at')
    .on('invitations')
    .column('expires_at')
    .execute();

  await sql`
    CREATE INDEX idx_invitations_deleted_at
      ON invitations (deleted_at)
      WHERE deleted_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invitations').execute();
}
