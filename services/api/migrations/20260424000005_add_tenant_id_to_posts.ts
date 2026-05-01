/**
 * Backfill `posts` with `tenant_id`. Posts are tenant-owned -- every row
 * belongs to exactly one workspace, derived from the author's home
 * tenant.
 *
 *  1. Add `tenant_id uuid` as nullable + FK -> `tenants(id)`.
 *  2. Backfill via JOIN to `users.tenant_id` (the prior migration set
 *     every user's `tenant_id`, so this leaves no orphan rows).
 *  3. Flip to `NOT NULL` and drop the default.
 *  4. Add the standard `(tenant_id, created_at)` composite index for the
 *     scoped list view.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('posts')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('cascade'),
    )
    .execute();

  await sql`
    UPDATE posts p
       SET tenant_id = u.tenant_id
      FROM users u
     WHERE p.author_id = u.id
       AND p.tenant_id IS NULL
  `.execute(db);

  await db.schema
    .alterTable('posts')
    .alterColumn('tenant_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .createIndex('idx_posts_tenant_created_at')
    .on('posts')
    .columns(['tenant_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_posts_tenant_created_at')
    .on('posts')
    .execute();
  await db.schema.alterTable('posts').dropColumn('tenant_id').execute();
}
