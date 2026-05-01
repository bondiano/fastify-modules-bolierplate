/**
 * Cross-tenant isolation + migration round-trip tests against a real
 * PGlite-backed Kysely instance. These complement the fast unit tests in
 * `repository.test.ts` (fake-trx recorder) and `plugin.test.ts`
 * (fastify.inject) by proving that:
 *
 *   - The canonical migrations apply cleanly in order.
 *   - `createTenantScopedRepository` injects the SQL `WHERE tenant_id = :current`
 *     and reads/writes really stay scoped at the database level.
 *   - The cross-tenant escape hatch (`unscoped()`) genuinely returns rows
 *     across tenants.
 *   - The cross-tenant lookups on `membershipsRepository` (`findAllForUser`,
 *     `findDefaultForUser`) walk every membership regardless of frame.
 *   - `withTenant()` AsyncLocalStorage frames don't leak between async
 *     siblings.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ColumnType, Generated } from 'kysely';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTransactionFactory,
  createTransactionStorage,
  type Trx,
} from '@kit/db/runtime';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';

import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
} from './context.js';
import { TenantNotResolved } from './errors.js';
import { createMembershipsRepository } from './memberships-repository.js';
import { createTenantScopedRepository } from './repository.js';
import type { TenancyDB } from './schema.js';
import { createTenantsRepository } from './tenants-repository.js';

interface UsersTable {
  id: Generated<string>;
  email: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

interface ItemsTable {
  id: Generated<string>;
  tenantId: string;
  title: string;
  createdAt: ColumnType<Date, string | undefined, string | undefined>;
}

interface DB extends TenancyDB {
  users: UsersTable;
  items: ItemsTable;
}

const migrationsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

interface Fixture {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
  readonly close: () => Promise<void>;
  readonly tenantId: (slug: string) => string;
}

const buildFixture = async (): Promise<Fixture> => {
  const dataSource = await createTestDataSource<DB>();

  // Provide a `users` table for the FK from `memberships.user_id`.
  await dataSource.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Run the canonical tenancy migrations first so `tenants` exists, then
  // create the domain `items` table with its FK to tenants. The previous
  // try/catch dance around an early createTable was masking the simple
  // ordering: migrate -> create items.
  await migrateToLatest(dataSource, migrationsPath);

  await dataSource.schema
    .createTable('items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade'),
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  const transactionStorage = await createTransactionStorage<DB>();
  const transaction = createTransactionFactory<DB>({
    dataSource,
    transactionStorage,
  });
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });

  // Seed two tenants for cross-tenant assertions.
  const acme = await dataSource
    .insertInto('tenants')
    .values({ slug: 'acme', name: 'Acme' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const globex = await dataSource
    .insertInto('tenants')
    .values({ slug: 'globex', name: 'Globex' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const tenantIds: Record<string, string> = {
    acme: acme.id,
    globex: globex.id,
  };

  return {
    transaction,
    tenantContext,
    close: () => dataSource.destroy(),
    tenantId: (slug) => tenantIds[slug] ?? slug,
  };
};

describe('tenancy integration -- migrations + cross-tenant isolation', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });

  afterEach(async () => {
    await f.close();
  });

  it('runs the canonical migrations and exposes tenants/memberships/invitations', async () => {
    const tenants = createTenantsRepository<DB>({
      transaction: f.transaction,
    });
    const acme = await tenants.findBySlug('acme');
    expect(acme?.name).toBe('Acme');
    const globex = await tenants.findBySlug('globex');
    expect(globex?.name).toBe('Globex');
  });

  it('createTenantScopedRepository injects WHERE tenant_id = :current at SQL level', async () => {
    const repo = createTenantScopedRepository<DB, 'items'>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
      tableName: 'items',
    });

    await f.tenantContext.withTenant(f.tenantId('acme'), async () => {
      await repo.create({ title: 'Acme #1' } as never);
      await repo.create({ title: 'Acme #2' } as never);
    });
    await f.tenantContext.withTenant(f.tenantId('globex'), async () => {
      await repo.create({ title: 'Globex #1' } as never);
    });

    // Acme frame sees only Acme's rows.
    const acmeRows = await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.findAll(),
    );
    expect(acmeRows).toHaveLength(2);
    for (const row of acmeRows as Array<{ tenantId: string; title: string }>) {
      expect(row.tenantId).toBe(f.tenantId('acme'));
    }

    // Globex frame sees only Globex's row.
    const globexRows = await f.tenantContext.withTenant(
      f.tenantId('globex'),
      async () => repo.findAll(),
    );
    expect(globexRows).toHaveLength(1);
    expect((globexRows as Array<{ title: string }>)[0]!.title).toBe(
      'Globex #1',
    );

    // Pagination totals are scoped too.
    const acmePage = await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.findPaginatedByPage({ page: 1, limit: 10 }),
    );
    expect(acmePage.total).toBe(2);
  });

  it('cross-tenant updates and deletes are inert (target row stays untouched)', async () => {
    const repo = createTenantScopedRepository<DB, 'items'>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
      tableName: 'items',
    });

    const created = (await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.create({ title: 'A1' } as never),
    )) as { id: string };

    const updated = await f.tenantContext.withTenant(
      f.tenantId('globex'),
      async () => repo.update(created.id, { title: 'hijacked' } as never),
    );
    expect(updated).toBeUndefined();

    const deleted = await f.tenantContext.withTenant(
      f.tenantId('globex'),
      async () => repo.deleteById(created.id),
    );
    expect(deleted).toBeUndefined();

    // Row still exists with original title under the rightful tenant.
    const acmeRows = (await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.findAll(),
    )) as Array<{ id: string; title: string }>;
    expect(acmeRows).toHaveLength(1);
    expect(acmeRows[0]!.title).toBe('A1');
  });

  it('unscoped() escape hatch returns every row across tenants', async () => {
    const repo = createTenantScopedRepository<DB, 'items'>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
      tableName: 'items',
    });

    await f.tenantContext.withTenant(f.tenantId('acme'), async () =>
      repo.create({ title: 'A' } as never),
    );
    await f.tenantContext.withTenant(f.tenantId('globex'), async () =>
      repo.create({ title: 'G' } as never),
    );

    const all = await repo.unscoped().findAll();
    expect(all).toHaveLength(2);
  });

  it('throws TenantNotResolved when the scoped repo is called outside withTenant', async () => {
    const repo = createTenantScopedRepository<DB, 'items'>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
      tableName: 'items',
    });

    await expect(repo.findAll()).rejects.toBeInstanceOf(TenantNotResolved);
  });

  it('membershipsRepository.findAllForUser walks across tenants without a frame', async () => {
    const memberships = createMembershipsRepository<DB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });

    // Seed a user; tenancy migrations don't manage it, hence the raw insert.
    const user = await f.transaction
      .insertInto('users')
      .values({ email: 'multi@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await f.tenantContext.withTenant(f.tenantId('acme'), async () => {
      await memberships.create({
        userId: user.id,
        joinedAt: new Date().toISOString(),
      } as never);
    });
    await f.tenantContext.withTenant(f.tenantId('globex'), async () => {
      await memberships.create({
        userId: user.id,
        joinedAt: new Date().toISOString(),
      } as never);
    });

    const all = await memberships.findAllForUser(user.id);
    expect(all).toHaveLength(2);
    const tenantIds = new Set(all.map((m) => m.tenantId));
    expect(tenantIds).toEqual(
      new Set([f.tenantId('acme'), f.tenantId('globex')]),
    );
  });

  it('withTenant frames do not leak between concurrent async siblings', async () => {
    const observed: string[] = [];
    await Promise.all([
      f.tenantContext.withTenant(f.tenantId('acme'), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observed.push(f.tenantContext.currentTenant().tenantId);
      }),
      f.tenantContext.withTenant(f.tenantId('globex'), async () => {
        observed.push(f.tenantContext.currentTenant().tenantId);
      }),
    ]);
    expect(new Set(observed)).toEqual(
      new Set([f.tenantId('acme'), f.tenantId('globex')]),
    );
  });
});
