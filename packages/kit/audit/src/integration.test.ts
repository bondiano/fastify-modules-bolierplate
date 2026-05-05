/**
 * End-to-end coverage of the audit migration + repository against a real
 * PGlite-backed Kysely instance. Complements the fast unit tests
 * (`diff.test.ts`, `audit-log-repository.test.ts` fake-trx,
 * `plugin.test.ts` fastify.inject) by proving:
 *
 *   - The migration applies cleanly on top of the canonical tenancy schema.
 *   - `createAuditLogRepository` writes through the real Postgres types
 *     (jsonb, timestamps, FKs) without translation hiccups.
 *   - Tenant-scoped reads filter to the active frame at the SQL level.
 *   - `unscoped()` walks every row across tenants.
 *   - `pruneOlderThan` actually removes rows and reports the count.
 *   - Redaction round-trips through the DB (jsonb stores `[REDACTED]`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Migrator,
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTransactionFactory,
  createTransactionStorage,
  type Trx,
} from '@kit/db/runtime';
import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
} from '@kit/tenancy';
import { createTestDataSource } from '@kit/test/database';

import {
  createAuditLogRepository,
  type AuditLogInsert,
} from './audit-log-repository.js';
import { computeDiff } from './diff.js';
import type { AuditDB } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tenancyMigrations = path.resolve(
  here,
  '..',
  '..',
  'tenancy',
  'migrations',
);
const auditMigrations = path.resolve(here, '..', 'migrations');

/**
 * `@kit/db/cli`'s `FileMigrationProvider`-based migrator only sees one
 * folder, so calling `migrateToLatest` twice (once per kit) confuses
 * Kysely's tracker -- the second call sees the tenancy rows in
 * `kysely_migration` but not the matching files. For tests we merge both
 * folders into a single ordered set and run once. Real services do the
 * same effectively by copying both kit's migration files into their own
 * `migrations/` folder (see `services/api/migrations/`).
 */
const mergedMigrationProvider = (
  ...folders: readonly string[]
): MigrationProvider => ({
  async getMigrations() {
    const migrations: Record<string, Migration> = {};
    for (const folder of folders) {
      const files = await fs.readdir(folder);
      const tsFiles = files
        .filter((f) => f.endsWith('.ts'))
        .toSorted((a, b) => a.localeCompare(b));
      for (const file of tsFiles) {
        const name = file.replace(/\.ts$/, '');
        const url = pathToFileURL(path.join(folder, file)).href;
        migrations[name] = (await import(url)) as Migration;
      }
    }
    return migrations;
  },
});

const runAllMigrations = async <DB>(dataSource: Kysely<DB>): Promise<void> => {
  const migrator = new Migrator({
    db: dataSource,
    provider: mergedMigrationProvider(tenancyMigrations, auditMigrations),
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

interface Fixture {
  readonly transaction: Trx<AuditDB>;
  readonly tenantContext: TenantContext;
  readonly close: () => Promise<void>;
  readonly tenantId: (slug: string) => string;
  readonly userId: (key: string) => string;
}

const buildFixture = async (): Promise<Fixture> => {
  const dataSource = await createTestDataSource<AuditDB>();

  // FK target for memberships.user_id (audit's audit_log.actor_id also FKs
  // here, so we need the table before the audit migration runs).
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

  // One migration pass against the merged provider (see notes above).
  await runAllMigrations(dataSource);

  const transactionStorage = await createTransactionStorage<AuditDB>();
  const transaction = createTransactionFactory<AuditDB>({
    dataSource,
    transactionStorage,
  });
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });

  // Seed two tenants.
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

  // Seed two users for actor_id assertions.
  const alice = await dataSource
    .insertInto('users')
    .values({ email: 'alice@example.com' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const bob = await dataSource
    .insertInto('users')
    .values({ email: 'bob@example.com' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const tenantIds: Record<string, string> = {
    acme: acme.id,
    globex: globex.id,
  };
  const userIds: Record<string, string> = { alice: alice.id, bob: bob.id };

  return {
    transaction,
    tenantContext,
    close: () => dataSource.destroy(),
    tenantId: (slug) => tenantIds[slug] ?? slug,
    userId: (key) => userIds[key] ?? key,
  };
};

const baseEntry = (
  overrides: Partial<AuditLogInsert<AuditDB>> & { tenantId: string | null },
): AuditLogInsert<AuditDB> => ({
  tenantId: overrides.tenantId,
  actorId: overrides.actorId ?? null,
  subjectType: overrides.subjectType ?? 'Post',
  subjectId: overrides.subjectId ?? 'p-1',
  action: overrides.action ?? 'create',
  diff: overrides.diff ?? null,
  metadata: overrides.metadata ?? null,
  ip: overrides.ip ?? null,
  userAgent: overrides.userAgent ?? null,
  correlationId: overrides.correlationId ?? null,
  sensitive: overrides.sensitive ?? false,
});

describe('audit integration -- migration + repository round-trip', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await buildFixture();
  });
  afterEach(async () => {
    await f.close();
  });

  it('applies the audit migration cleanly on top of tenancy', async () => {
    // Sanity: the table exists, indexes are queryable, FKs resolve.
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });
    const row = await repo.append(
      baseEntry({
        tenantId: f.tenantId('acme'),
        actorId: f.userId('alice'),
        action: 'auth.login',
        subjectType: 'User',
        subjectId: f.userId('alice'),
      }),
    );
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.tenantId).toBe(f.tenantId('acme'));
    expect(row.actorId).toBe(f.userId('alice'));
    expect(row.sensitive).toBe(false);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('tenant-scoped findPaginatedByPage returns only rows for the active frame', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });

    await repo.append(baseEntry({ tenantId: f.tenantId('acme'), action: 'a' }));
    await repo.append(baseEntry({ tenantId: f.tenantId('acme'), action: 'b' }));
    await repo.append(
      baseEntry({ tenantId: f.tenantId('globex'), action: 'c' }),
    );
    // pre-tenant entry
    await repo.append(baseEntry({ tenantId: null, action: 'register' }));

    const acmePage = await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.findPaginatedByPage({ page: 1, limit: 50 }),
    );
    expect(acmePage.total).toBe(2);
    expect(acmePage.items.map((row) => row.action).toSorted()).toEqual([
      'a',
      'b',
    ]);

    const globexPage = await f.tenantContext.withTenant(
      f.tenantId('globex'),
      async () => repo.findPaginatedByPage({ page: 1, limit: 50 }),
    );
    expect(globexPage.total).toBe(1);
    expect(globexPage.items[0]!.action).toBe('c');
  });

  it('unscoped() returns every row including the null-tenant pre-tenant entry', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });

    await repo.append(baseEntry({ tenantId: f.tenantId('acme') }));
    await repo.append(baseEntry({ tenantId: f.tenantId('globex') }));
    await repo.append(baseEntry({ tenantId: null }));

    const all = await repo.unscoped().findAll();
    expect(all).toHaveLength(3);
    expect(all.filter((row) => row.tenantId === null)).toHaveLength(1);
  });

  it('appendMany batches multiple entries in one round-trip', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });
    await repo.appendMany([
      baseEntry({ tenantId: f.tenantId('acme'), action: 'x' }),
      baseEntry({ tenantId: f.tenantId('acme'), action: 'y' }),
      baseEntry({ tenantId: f.tenantId('acme'), action: 'z' }),
    ]);
    const acmePage = await f.tenantContext.withTenant(
      f.tenantId('acme'),
      async () => repo.findPaginatedByPage({ page: 1, limit: 50 }),
    );
    expect(acmePage.total).toBe(3);
  });

  it('pruneOlderThan deletes only rows older than the cutoff', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });

    // Two stale rows seeded with explicit old created_at.
    await f.transaction
      .insertInto('audit_log')
      .values([
        {
          tenantId: f.tenantId('acme'),
          subjectType: 'Post',
          subjectId: 'old-1',
          action: 'create',
          createdAt: new Date('2020-01-01T00:00:00Z').toISOString(),
        },
        {
          tenantId: f.tenantId('acme'),
          subjectType: 'Post',
          subjectId: 'old-2',
          action: 'create',
          createdAt: new Date('2020-06-01T00:00:00Z').toISOString(),
        },
      ])
      .execute();

    // Fresh row that should survive the prune.
    await repo.append(
      baseEntry({
        tenantId: f.tenantId('acme'),
        subjectId: 'fresh',
      }),
    );

    const cutoff = new Date('2024-01-01T00:00:00Z');
    const result = await repo.pruneOlderThan(cutoff);
    expect(result.deleted).toBe(2);

    const remaining = await repo.unscoped().findAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.subjectId).toBe('fresh');
  });

  it('redacted diff round-trips through jsonb with sensitive=true', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });
    const { diff, sensitive } = computeDiff(null, {
      email: 'a@b.com',
      password: 's3cret',
    });
    expect(sensitive).toBe(true);

    const row = await repo.append(
      baseEntry({
        tenantId: f.tenantId('acme'),
        action: 'create',
        subjectType: 'User',
        subjectId: f.userId('alice'),
        diff,
        sensitive,
      }),
    );

    const fetched = await repo.unscoped().findById(row.id);
    expect(fetched).toBeDefined();
    expect(fetched!.sensitive).toBe(true);
    const stored = fetched!.diff as Record<
      string,
      { before: unknown; after: unknown }
    >;
    expect(stored.email).toEqual({ before: null, after: 'a@b.com' });
    expect(stored.password).toEqual({ before: null, after: '[REDACTED]' });
  });

  it('FK ON DELETE SET NULL: hard-deleting a tenant nulls out tenant_id on its audit rows', async () => {
    const repo = createAuditLogRepository<AuditDB>({
      transaction: f.transaction,
      tenantContext: f.tenantContext,
    });
    const row = await repo.append(baseEntry({ tenantId: f.tenantId('acme') }));
    expect(row.tenantId).toBe(f.tenantId('acme'));

    // Hard delete the tenant. (Soft delete would leave tenant_id as-is; the
    // FK fires only on physical row removal.)
    await f.transaction
      .deleteFrom('tenants')
      .where('id', '=', f.tenantId('acme'))
      .execute();

    const after = await repo.unscoped().findById(row.id);
    expect(after).toBeDefined();
    expect(after!.tenantId).toBe(null);
  });
});
