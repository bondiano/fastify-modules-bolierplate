import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TenantNotFound,
  TenantSlugConflict,
  TenantSlugExhausted,
} from './errors.js';
import type { TenancyDB } from './schema.js';
import {
  createTenantsService,
  type TenantsServiceRepoView,
} from './tenants-service.js';

interface FakeTrxCalls {
  readonly memberships: Array<Record<string, unknown>>;
  readonly invitations: Array<Record<string, unknown>>;
}

interface FakeUpdateBuilder {
  set(values: Record<string, unknown>): FakeUpdateBuilder;
  where(...args: unknown[]): FakeUpdateBuilder;
  execute(): Promise<void>;
}

const dynamicRef = (col: string): unknown => ({ ref: col });

const buildFakeTrx = (calls: FakeTrxCalls) => {
  const updateBuilder = (
    table: 'memberships' | 'invitations',
  ): FakeUpdateBuilder => {
    const captured: Record<string, unknown> = { wheres: [] };
    const builder: FakeUpdateBuilder = {
      set(values) {
        captured['set'] = values;
        return builder;
      },
      where(_ref, _op, value) {
        (captured['wheres'] as unknown[]).push(value);
        return builder;
      },
      async execute() {
        calls[table].push(captured);
      },
    };
    return builder;
  };
  // The service uses transaction(cb) AND transaction.updateTable(...). Compose
  // both behaviours on a single callable proxy.
  const fn: (<T>(cb: () => Promise<T>) => Promise<T>) & {
    updateTable: (table: 'memberships' | 'invitations') => FakeUpdateBuilder;
    dynamic: { ref: typeof dynamicRef };
  } = Object.assign(async <T>(cb: () => Promise<T>): Promise<T> => cb(), {
    updateTable: updateBuilder,
    dynamic: { ref: dynamicRef },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fn as any;
};

const buildFakeRepository = () => {
  const state = {
    bySlug: new Map<
      string,
      { id: string; slug: string; deletedAt: string | null }
    >(),
    byId: new Map<string, { id: string; slug: string; name: string }>(),
  };
  let nextId = 1;
  const createCalls: Array<{ name: string; slug: string }> = [];
  const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const softDeleteCalls: string[] = [];

  const repo: TenantsServiceRepoView = {
    findById: vi.fn(async (id: string) => {
      const row = state.byId.get(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return row as any;
    }),
    findBySlugIncludingDeleted: vi.fn(async (slug: string) => {
      const row = state.bySlug.get(slug);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return row as any;
    }),
    create: vi.fn(async (data) => {
      createCalls.push({ name: data.name, slug: data.slug });
      const id = `t-${nextId++}`;
      const persisted = {
        id,
        name: data.name,
        slug: data.slug,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      state.byId.set(id, persisted);
      state.bySlug.set(data.slug, {
        id,
        slug: data.slug,
        deletedAt: null,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return persisted as any;
    }),
    update: vi.fn(async (id: string, patch) => {
      updateCalls.push({ id, patch: patch as Record<string, unknown> });
      const existing = state.byId.get(id);
      if (!existing) return;
      const merged = { ...existing, ...patch };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state.byId.set(id, merged as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return merged as any;
    }),
    softDelete: vi.fn(async (id: string) => {
      softDeleteCalls.push(id);
      const existing = state.byId.get(id);
      if (!existing) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...existing, deletedAt: new Date().toISOString() } as any;
    }),
    findPaginatedByPage: vi.fn(async () => ({ items: [], total: 0 })),
  };

  const seed = (row: {
    id: string;
    slug: string;
    deletedAt?: string | null;
  }) => {
    state.byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.slug,
    });
    state.bySlug.set(row.slug, {
      id: row.id,
      slug: row.slug,
      deletedAt: row.deletedAt ?? null,
    });
  };

  return { repo, createCalls, updateCalls, softDeleteCalls, seed };
};

describe('createTenantsService', () => {
  let fixture: ReturnType<typeof buildFakeRepository>;
  let trxCalls: FakeTrxCalls;

  beforeEach(() => {
    fixture = buildFakeRepository();
    trxCalls = { memberships: [], invitations: [] };
  });

  const buildService = () =>
    createTenantsService<TenancyDB>({
      tenantsRepository: fixture.repo,
      transaction: buildFakeTrx(trxCalls),
    });

  it('create derives slug from name via slugify', async () => {
    const service = buildService();
    const tenant = await service.create({ name: 'Acme Corp' });
    expect(tenant.slug).toBe('acme-corp');
    expect(fixture.createCalls).toEqual([
      { name: 'Acme Corp', slug: 'acme-corp' },
    ]);
  });

  it('create adds a numeric suffix when the slug is already taken', async () => {
    fixture.seed({ id: 't-existing', slug: 'acme' });
    const service = buildService();
    const tenant = await service.create({ name: 'ACME' });
    expect(tenant.slug).toBe('acme-2');
  });

  it('create treats a soft-deleted slug as taken (reuse is unsafe)', async () => {
    fixture.seed({
      id: 't-deleted',
      slug: 'acme',
      deletedAt: '2026-01-01T00:00:00Z',
    });
    const service = buildService();
    const tenant = await service.create({ name: 'Acme' });
    expect(tenant.slug).toBe('acme-2');
  });

  it('create walks multiple suffix collisions (2, 3, 4, ...)', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    fixture.seed({ id: 't-2', slug: 'acme-2' });
    fixture.seed({ id: 't-3', slug: 'acme-3' });
    const service = buildService();
    const tenant = await service.create({ name: 'Acme' });
    expect(tenant.slug).toBe('acme-4');
  });

  it('create respects an explicit slug override (still sluggified)', async () => {
    const service = buildService();
    const tenant = await service.create({ name: 'Acme', slug: 'Beta Corp' });
    expect(tenant.slug).toBe('beta-corp');
  });

  it('create caps the base slug so suffix collisions stay within 63 chars', async () => {
    const longName = 'a'.repeat(120);
    const service = buildService();
    const tenant = await service.create({ name: longName });
    expect(tenant.slug.length).toBeLessThanOrEqual(63);
    // Base is capped at 59 chars to leave room for `-NN` (4-char suffix).
    expect(tenant.slug.length).toBe(59);
  });

  it('create throws TenantSlugExhausted after 100 collisions', async () => {
    for (let index = 0; index < 100; index++) {
      fixture.seed({
        id: `t-${index}`,
        slug: index === 0 ? 'acme' : `acme-${index + 1}`,
      });
    }
    const service = buildService();
    await expect(service.create({ name: 'Acme' })).rejects.toBeInstanceOf(
      TenantSlugExhausted,
    );
  });

  it('rename updates name but leaves slug stable unless requested', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    const service = buildService();
    await service.rename('t-1', { name: 'Acme Prime' });
    expect(fixture.updateCalls[0]!.patch).toMatchObject({ name: 'Acme Prime' });
    expect(fixture.updateCalls[0]!.patch['slug']).toBeUndefined();
  });

  it('rename updates slug when explicitly passed (slugified)', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    const service = buildService();
    await service.rename('t-1', { slug: 'New Name' });
    expect(fixture.updateCalls[0]!.patch['slug']).toBe('new-name');
  });

  it('rename throws TenantSlugConflict when another tenant holds the target slug', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    fixture.seed({ id: 't-2', slug: 'globex' });
    const service = buildService();
    await expect(
      service.rename('t-1', { slug: 'globex' }),
    ).rejects.toBeInstanceOf(TenantSlugConflict);
  });

  it('rename allows renaming a tenant to its own current slug (self-collision)', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    const service = buildService();
    await expect(
      service.rename('t-1', { slug: 'acme' }),
    ).resolves.toBeDefined();
  });

  it('rename throws TenantNotFound for unknown ids', async () => {
    const service = buildService();
    await expect(
      service.rename('missing', { name: 'X' }),
    ).rejects.toBeInstanceOf(TenantNotFound);
  });

  it('softDelete cascades deletedAt onto memberships + invitations', async () => {
    fixture.seed({ id: 't-1', slug: 'acme' });
    const service = buildService();
    await service.softDelete('t-1');
    expect(fixture.softDeleteCalls).toEqual(['t-1']);
    expect(trxCalls.memberships).toHaveLength(1);
    expect(trxCalls.invitations).toHaveLength(1);
    // Each cascade UPDATE filters on (tenantId = 't-1' AND deletedAt IS NULL).
    expect(trxCalls.memberships[0]!['set']).toMatchObject({
      deletedAt: expect.any(String),
    });
    expect(
      (trxCalls.memberships[0]!['wheres'] as unknown[]).includes('t-1'),
    ).toBe(true);
  });

  it('softDelete throws TenantNotFound when the tenant is missing', async () => {
    const service = buildService();
    await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
      TenantNotFound,
    );
    // Cascades skipped on the throw path.
    expect(trxCalls.memberships).toHaveLength(0);
    expect(trxCalls.invitations).toHaveLength(0);
  });

  it('list delegates to findPaginatedByPage', async () => {
    const service = buildService();
    await service.list({ page: 2, limit: 10 });
    expect(fixture.repo.findPaginatedByPage).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
    });
  });
});
