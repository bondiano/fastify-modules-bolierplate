import { beforeEach, describe, expect, it } from 'vitest';

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
import { createMembershipsRepository } from './memberships-repository.js';
import type { TenancyDB } from './schema.js';

describe('createMembershipsRepository', () => {
  let storage: TenantStorage;
  let tenantContext: TenantContext;
  let recorded: Recorded;
  let trx: Trx<TenancyDB>;

  beforeEach(() => {
    storage = createTenantStorage();
    tenantContext = createTenantContext({ tenantStorage: storage });
    recorded = freshRecorded();
    trx = buildFakeTrx<TenancyDB>(recorded);
  });

  it('inherits tenant-scoped reads from the soft-delete base (filters deletedAt)', async () => {
    recorded.resultForSingle = {
      id: 'm-1',
      tenantId: 'acme',
      userId: 'u-1',
    };
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findById('m-1');
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['deletedAt', 'is', null],
      ['id', '=', 'm-1'],
    ]);
  });

  it('findByUserIdInCurrentTenant scopes to tenant + user + deletedAt IS NULL', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findByUserIdInCurrentTenant('u-1');
    });
    expect(recorded.calls[0]!.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['userId', '=', 'u-1'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('markJoinedByUserId updates joinedAt scoped to active membership', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.markJoinedByUserId('u-1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toHaveProperty('joinedAt');
    expect(call.wheres).toEqual([
      ['tenantId', '=', 'acme'],
      ['userId', '=', 'u-1'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('findAllForUser is cross-tenant but filters revoked memberships', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await repo.findAllForUser('u-1');
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('select');
    expect(call.wheres).toEqual([
      ['userId', '=', 'u-1'],
      ['deletedAt', 'is', null],
    ]);
    expect(call.orderBy).toEqual({ field: 'joinedAt', direction: 'asc' });
  });

  it('findDefaultForUser filters out un-accepted and revoked memberships', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await repo.findDefaultForUser('u-1');
    const call = recorded.calls[0]!;
    expect(call.wheres).toEqual([
      ['userId', '=', 'u-1'],
      ['joinedAt', 'is not', null],
      ['deletedAt', 'is', null],
    ]);
    expect(call.orderBy).toEqual({ field: 'joinedAt', direction: 'asc' });
    expect(call.limit).toBe(1);
  });

  it('findByUserAndTenant lookups the active membership without a frame', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await repo.findByUserAndTenant('u-1', 't-1');
    const call = recorded.calls[0]!;
    expect(call.wheres).toEqual([
      ['userId', '=', 'u-1'],
      ['tenantId', '=', 't-1'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('scoped create stamps tenantId from the active frame', async () => {
    recorded.resultForSingle = { id: 'm-1' };
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      const payload: Record<string, unknown> = {
        userId: 'u-1',
        role: 'member',
        invitedBy: 'u-0',
        joinedAt: null,
      };
      await repo.create(payload);
    });
    expect(recorded.calls[0]!.values).toMatchObject({
      userId: 'u-1',
      tenantId: 'acme',
    });
  });

  it('scoped deleteById is now soft-delete (UPDATE deletedAt) scoped to tenant', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.deleteById('m-1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toHaveProperty('deletedAt');
    // The user-supplied id is appended first; the active() filter then
    // layers tenantId + deletedAt IS NULL.
    expect(call.wheres).toEqual([
      ['id', '=', 'm-1'],
      ['tenantId', '=', 'acme'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('tenant-scoped operations throw TenantNotResolved without a frame', async () => {
    const repo = createMembershipsRepository({
      transaction: trx,
      tenantContext,
    });
    await expect(
      repo.findByUserIdInCurrentTenant('u-1'),
    ).rejects.toBeInstanceOf(TenantNotResolved);
  });
});
