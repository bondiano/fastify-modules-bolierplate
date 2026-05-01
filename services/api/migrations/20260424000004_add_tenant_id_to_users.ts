/**
 * Backfill `users` with `tenant_id`. Users are global accounts, but the
 * boilerplate keeps a "home tenant" reference on the row so the admin
 * panel can scope user lists by workspace and so a fresh registration
 * can drop the user into a sensible tenant by default.
 *
 * Steps (matches `@kit/tenancy/migrations/_template/...`):
 *
 *  1. Seed a `Default Workspace` tenant if it doesn't exist yet (the
 *     migration is idempotent under `ON CONFLICT (slug)`).
 *  2. Add `tenant_id uuid` as nullable + FK -> `tenants(id)`.
 *  3. Backfill every existing user to the seed tenant.
 *  4. Flip `tenant_id` to `NOT NULL` and drop the default so future
 *     writes must supply it explicitly.
 *  5. Add the standard `(tenant_id, created_at)` composite index.
 *  6. Seed a membership for every existing user (role mirrors
 *     `users.role`: `admin` -> `owner`, otherwise `member`) so they
 *     authorize correctly once `request.membership` is wired.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const DEFAULT_TENANT_SLUG = 'default';
const DEFAULT_TENANT_NAME = 'Default Workspace';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO tenants (slug, name)
    VALUES (${DEFAULT_TENANT_SLUG}, ${DEFAULT_TENANT_NAME})
    ON CONFLICT (slug) DO NOTHING
  `.execute(db);

  await db.schema
    .alterTable('users')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.references('tenants.id').onDelete('cascade'),
    )
    .execute();

  await sql`
    UPDATE users
       SET tenant_id = (SELECT id FROM tenants WHERE slug = ${DEFAULT_TENANT_SLUG})
     WHERE tenant_id IS NULL
  `.execute(db);

  await db.schema
    .alterTable('users')
    .alterColumn('tenant_id', (col) => col.setNotNull())
    .execute();

  await db.schema
    .createIndex('idx_users_tenant_created_at')
    .on('users')
    .columns(['tenant_id', 'created_at'])
    .execute();

  // Backfill memberships so existing users authorize cleanly under the
  // default tenant. `ON CONFLICT (tenant_id, user_id) DO NOTHING` keeps
  // the migration idempotent if a re-run replays the seed step.
  await sql`
    INSERT INTO memberships (tenant_id, user_id, role, joined_at)
    SELECT u.tenant_id,
           u.id,
           CASE WHEN u.role = 'admin' THEN 'owner' ELSE 'member' END,
           now()
      FROM users u
     WHERE NOT EXISTS (
       SELECT 1 FROM memberships m
        WHERE m.tenant_id = u.tenant_id AND m.user_id = u.id
     )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Memberships seeded above are dropped by `create_memberships` rollback.
  await db.schema
    .dropIndex('idx_users_tenant_created_at')
    .on('users')
    .execute();
  await db.schema.alterTable('users').dropColumn('tenant_id').execute();
}
