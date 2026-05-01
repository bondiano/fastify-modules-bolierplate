import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('tenants')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('slug', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // Partial index: most rows are live (deleted_at IS NULL), so a full index
  // wastes space and the planner ignores it. Only the soft-delete sweep
  // (e.g. cleanup jobs querying WHERE deleted_at IS NOT NULL) benefits.
  await sql`
    CREATE INDEX idx_tenants_deleted_at
      ON tenants (deleted_at)
      WHERE deleted_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('tenants').execute();
}
