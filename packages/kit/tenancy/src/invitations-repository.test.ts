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
import { createInvitationsRepository } from './invitations-repository.js';
import type { TenancyDB } from './schema.js';

describe('createInvitationsRepository', () => {
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

  it('findByTokenHash is cross-tenant but skips soft-deleted rows', async () => {
    const repo = createInvitationsRepository({
      transaction: trx,
      tenantContext,
    });
    await repo.findByTokenHash('hash-abc');
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('select');
    expect(call.wheres).toEqual([
      ['tokenHash', '=', 'hash-abc'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('findPendingByEmail scopes by tenant + not accepted + not soft-deleted + not expired', async () => {
    const repo = createInvitationsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.findPendingByEmail('invitee@example.com');
    });
    const call = recorded.calls[0]!;
    expect(call.wheres[0]).toEqual(['tenantId', '=', 'acme']);
    expect(call.wheres[1]).toEqual(['email', '=', 'invitee@example.com']);
    expect(call.wheres[2]).toEqual(['acceptedAt', 'is', null]);
    expect(call.wheres[3]).toEqual(['deletedAt', 'is', null]);
    expect(call.wheres[4]![0]).toBe('expiresAt');
    expect(call.wheres[4]![1]).toBe('>');
  });

  it('markAccepted is the atomic gate (filters acceptedAt + deletedAt + expiresAt > now)', async () => {
    const repo = createInvitationsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      await repo.markAccepted('inv-1');
    });
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toHaveProperty('acceptedAt');
    expect(call.wheres[0]).toEqual(['tenantId', '=', 'acme']);
    expect(call.wheres[1]).toEqual(['id', '=', 'inv-1']);
    expect(call.wheres[2]).toEqual(['acceptedAt', 'is', null]);
    expect(call.wheres[3]).toEqual(['deletedAt', 'is', null]);
    expect(call.wheres[4]![0]).toBe('expiresAt');
    expect(call.wheres[4]![1]).toBe('>');
  });

  it('inherits tenant-scoped create (stamps tenantId)', async () => {
    recorded.resultForSingle = { id: 'inv-1' };
    const repo = createInvitationsRepository({
      transaction: trx,
      tenantContext,
    });
    await tenantContext.withTenant('acme', async () => {
      const payload: Record<string, unknown> = {
        email: 'x@example.com',
        role: 'member',
        tokenHash: 'hash',
        expiresAt: '2030-01-01T00:00:00Z',
        acceptedAt: null,
        invitedBy: 'u-0',
      };
      await repo.create(payload);
    });
    expect(recorded.calls[0]!.values).toMatchObject({
      email: 'x@example.com',
      tenantId: 'acme',
    });
  });

  it('tenant-scoped operations throw TenantNotResolved without a frame', async () => {
    const repo = createInvitationsRepository({
      transaction: trx,
      tenantContext,
    });
    await expect(
      repo.findPendingByEmail('x@example.com'),
    ).rejects.toBeInstanceOf(TenantNotResolved);
  });
});
