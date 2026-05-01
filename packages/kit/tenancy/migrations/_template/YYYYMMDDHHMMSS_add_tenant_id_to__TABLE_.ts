/**
 * Backfill migration template -- adds `tenant_id NOT NULL` + FK + index to
 * an existing table. Three-step pattern keeps the migration safe under
 * concurrent writes: add as nullable with a default, backfill, then flip
 * to NOT NULL and drop the default so subsequent writes must supply it.
 *
 * Usage:
 *  1. Copy this file to `<service>/migrations/<timestamp>_add_tenant_id_to_<table>.ts`
 *  2. Replace every `__TABLE__` with your table name.
 *  3. Replace `__DEFAULT_TENANT_ID__` with the UUID of the tenant that owns
 *     every existing row (create it via `@kit/tenancy` tooling first). Use
 *     raw SQL in `down()` only if you cannot recover via the new code path.
 *  4. After the migration ships, swap the repository factory for
 *     `createTenantScopedRepository` / `createTenantScopedSoftDeleteRepository`.
 *
 * Mechanics:
 *  - The default clause is present only during backfill -- once the column
 *    is NOT NULL, it is dropped so future writes are forced to provide a
 *    tenant explicitly (matching the `tenantScoped()` repository's behaviour).
 *  - The `(tenant_id, created_at DESC)` composite index covers the common
 *    "list scoped + sorted" query shape. Swap the sort column or drop the
 *    index altogether if your table never paginates by `created_at`.
 *  - When backfilling by some natural key (e.g. `author_id -> membership`)
 *    rather than a single default, replace the UPDATE below with the
 *    join-driven variant before dropping the default.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('__TABLE__')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('cascade'),
    )
    .execute();

  await sql`
    UPDATE __TABLE__
       SET tenant_id = ${sql.lit('__DEFAULT_TENANT_ID__')}::uuid
     WHERE tenant_id IS NULL
  `.execute(db);

  await db.schema
    .alterTable('__TABLE__')
    .alterColumn('tenant_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .createIndex('idx___TABLE___tenant_created_at')
    .on('__TABLE__')
    .columns(['tenant_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx___TABLE___tenant_created_at')
    .on('__TABLE__')
    .execute();

  await db.schema.alterTable('__TABLE__').dropColumn('tenant_id').execute();
}
