import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Trx } from '@kit/db/runtime';

import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
  type TenantStorage,
} from './context.js';
import { TenantNotResolved } from './errors.js';
import {
  buildFakeTrx,
  freshRecorded,
  type Recorded,
} from './fake-trx.test-helpers.js';
import {
  createTenantScopedRepository,
  createTenantScopedSoftDeleteRepository,
} from './repository.js';

interface FakeDB {
  posts: {
    id: string;
    tenantId: string;
    title: string;
    deletedAt: string | null;
  };
}

describe('createTenantScopedRepository', () => {
  let storage: TenantStorage;
  let tenantContext: TenantContext;
  let recorded: Recorded;
  let trx: Trx<FakeDB>;

  beforeEach(async () => {
    storage = createTenantStorage();
    tenantContext = createTenantContext({ tenantStorage: storage });
    recorded = freshRecorded();
    trx = buildFakeTrx<FakeDB>(recorded);
  });

  it('injects the tenant filter on findById', async () => {
    recorded.resultForSingle = {
      id: '1',
      tenantId: 'acme',
      title: 'Hello',
      deletedAt: null,
    };
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findById('1');
    });
    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]!.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['id', '=', '1'],
    ]);
  });

  it('stamps tenantId onto create payloads', async () => {
    recorded.resultForSingle = { id: 'new' };
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.create({ id: 'new', title: 'Hello' } as FakeDB['posts']);
    });
    expect(recorded.calls[0]!.values).toEqual({
      id: 'new',
      title: 'Hello',
      tenantId: 'acme',
    });
  });

  it('overrides any tenantId passed in a create payload', async () => {
    recorded.resultForSingle = { id: 'new' };
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.create({
        id: 'new',
        title: 'x',
        tenantId: 'globex',
      } as FakeDB['posts']);
    });
    expect(recorded.calls[0]!.values!['tenantId']).toBe('acme');
  });

  it('scopes updates to the active tenant', async () => {
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.update('1', { title: 'Renamed' });
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['id', '=', '1'],
      ['tenantId', '=', 'acme'],
    ]);
    expect(recorded.calls[0]!.setValues).toEqual({ title: 'Renamed' });
  });

  it('strips any tenantId from update payloads (defence-in-depth)', async () => {
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      // Public type forbids `tenantId`; the cast simulates an attacker
      // who bypasses TS to pass it through. Runtime must reject it.
      const payload: Record<string, unknown> = {
        title: 'Renamed',
        tenantId: 'globex',
      };
      await repo.update('1', payload);
    });
    expect(recorded.calls[0]!.setValues).toEqual({ title: 'Renamed' });
    expect(recorded.calls[0]!.setValues).not.toHaveProperty('tenantId');
  });

  it('scopes deletes to the active tenant', async () => {
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.deleteById('1');
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['id', '=', '1'],
      ['tenantId', '=', 'acme'],
    ]);
    expect(recorded.calls[0]!.kind).toBe('delete');
  });

  it('scopes count queries', async () => {
    recorded.countValue = 7;
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    const total = await tenantContext.withTenant('acme', async () =>
      repo.count(),
    );
    expect(total).toBe(7);
    expect(recorded.calls[0]!.wheres).toEqual([['tenantId', '=', 'acme']]);
  });

  it('scopes both the select and count sides of findPaginatedByPage', async () => {
    recorded.resultForExecute = [];
    recorded.countValue = 3;
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    const page = await tenantContext.withTenant('acme', async () =>
      repo.findPaginatedByPage({ page: 2, limit: 10, orderByField: 'id' }),
    );
    expect(page.total).toBe(3);
    expect(recorded.calls).toHaveLength(2);
    for (const call of recorded.calls) {
      expect(call.wheres[0]).toEqual(['tenantId', '=', 'acme']);
    }
    const selectCall = recorded.calls[0]!;
    expect(selectCall.limit).toBe(10);
    expect(selectCall.offset).toBe(10);
    expect(selectCall.orderBy).toEqual({ field: 'id', direction: 'desc' });
  });

  it('honours a custom tenant column name', async () => {
    recorded.resultForSingle = undefined;
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
      tenantColumn: 'tenant_id',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findById('1');
    });
    expect(recorded.calls[0]!.wheres[0]).toEqual(['tenant_id', '=', 'acme']);
  });

  it('throws TenantNotResolved when no frame is active', async () => {
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await expect(repo.findById('1')).rejects.toBeInstanceOf(TenantNotResolved);
  });

  it('unscoped() returns a BaseRepository that skips tenant filtering', async () => {
    recorded.resultForSingle = { id: '1' };
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    const bare = repo.unscoped();
    await bare.findById('1');
    expect(recorded.calls[0]!.wheres).toEqual([['id', '=', '1']]);
    expect(bare.table).toBe('posts');
  });

  it('re-resolves the tenant per call', async () => {
    const spy = vi.spyOn(tenantContext, 'currentTenant');
    const repo = createTenantScopedRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findAll();
    });
    await tenantContext.withTenant('globex', async () => {
      await repo.findAll();
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(recorded.calls[0]!.wheres[0]![2]).toBe('acme');
    expect(recorded.calls[1]!.wheres[0]![2]).toBe('globex');
  });
});

describe('createTenantScopedSoftDeleteRepository', () => {
  let storage: TenantStorage;
  let tenantContext: TenantContext;
  let recorded: Recorded;
  let trx: Trx<FakeDB>;

  beforeEach(async () => {
    storage = createTenantStorage();
    tenantContext = createTenantContext({ tenantStorage: storage });
    recorded = freshRecorded();
    trx = buildFakeTrx<FakeDB>(recorded);
  });

  it('applies tenant + deletedAt filters on findById', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findById('1');
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['deletedAt', 'is', null],
      ['id', '=', '1'],
    ]);
  });

  it('strips any tenantId from update payloads (defence-in-depth)', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      const payload: Record<string, unknown> = {
        title: 'Renamed',
        tenantId: 'globex',
      };
      await repo.update('1', payload);
    });
    expect(recorded.calls[0]!.setValues).toEqual({ title: 'Renamed' });
    expect(recorded.calls[0]!.setValues).not.toHaveProperty('tenantId');
  });

  it('soft-deletes via updateTable scoped to tenant + not-deleted', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.softDelete('1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toHaveProperty('deletedAt');
    expect(call.wheres).toEqual([
      ['id', '=', '1'],
      ['tenantId', '=', 'acme'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('includes soft-deleted rows when using findByIdIncludingDeleted (tenant-scoped)', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findByIdIncludingDeleted('1');
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['id', '=', '1'],
    ]);
  });

  it('restore clears deletedAt scoped to tenant (not soft-delete filtered)', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.restore('1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toEqual({ deletedAt: null });
    expect(call.wheres).toEqual([
      ['id', '=', '1'],
      ['tenantId', '=', 'acme'],
    ]);
  });

  it('hardDeleteById removes the row scoped to tenant only', async () => {
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.hardDeleteById('1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('delete');
    expect(call.wheres).toEqual([
      ['id', '=', '1'],
      ['tenantId', '=', 'acme'],
    ]);
  });

  it('unscoped() returns a SoftDeleteRepository without tenant filtering', async () => {
    recorded.resultForSingle = { id: '1', deletedAt: null };
    const repo = createTenantScopedSoftDeleteRepository<FakeDB, 'posts'>({
      transaction: trx,
      tenantContext,
      tableName: 'posts',
    });
    const bare = repo.unscoped();
    await bare.findById('1');
    expect(recorded.calls[0]!.wheres).toEqual([
      ['deletedAt', 'is', null],
      ['id', '=', '1'],
    ]);
    expect(bare.table).toBe('posts');
  });
});
