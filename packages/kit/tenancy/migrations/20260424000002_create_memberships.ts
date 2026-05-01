import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('memberships')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('role', 'varchar(50)', (col) =>
      col.notNull().defaultTo('member'),
    )
    .addColumn('invited_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('joined_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // Partial unique index instead of a plain UNIQUE constraint. A revoked
  // membership keeps `deleted_at IS NOT NULL`, leaving the (tenant, user)
  // pair free for a future re-invite. Without the partial filter, revoked
  // rows would block re-joining the same tenant.
  await sql`
    CREATE UNIQUE INDEX uq_memberships_tenant_user_active
      ON memberships (tenant_id, user_id)
      WHERE deleted_at IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_memberships_tenant_id')
    .on('memberships')
    .column('tenant_id')
    .execute();

  await db.schema
    .createIndex('idx_memberships_user_id')
    .on('memberships')
    .column('user_id')
    .execute();

  await sql`
    CREATE INDEX idx_memberships_deleted_at
      ON memberships (deleted_at)
      WHERE deleted_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('memberships').execute();
}
