import { beforeEach, describe, expect, it } from 'vitest';

import type { Trx } from '@kit/db/runtime';

import {
  buildFakeTrx,
  freshRecorded,
  type Recorded,
} from './fake-trx.test-helpers.js';
import type { TenancyDB } from './schema.js';
import { createTenantsRepository } from './tenants-repository.js';

describe('createTenantsRepository', () => {
  let recorded: Recorded;
  let trx: Trx<TenancyDB>;

  beforeEach(() => {
    recorded = freshRecorded();
    trx = buildFakeTrx<TenancyDB>(recorded);
  });

  it('findBySlug filters by slug and deletedAt IS NULL', async () => {
    recorded.resultForSingle = {
      id: 't-1',
      slug: 'acme',
      name: 'Acme',
      deletedAt: null,
    };
    const repo = createTenantsRepository({ transaction: trx });
    await repo.findBySlug('acme');
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('select');
    expect(call.table).toBe('tenants');
    expect(call.wheres).toEqual([
      ['slug', '=', 'acme'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('findBySlugIncludingDeleted skips the deletedAt filter', async () => {
    const repo = createTenantsRepository({ transaction: trx });
    await repo.findBySlugIncludingDeleted('acme');
    expect(recorded.calls[0]!.wheres).toEqual([['slug', '=', 'acme']]);
  });

  it('exposes the soft-delete base methods (findById filters deletedAt)', async () => {
    const repo = createTenantsRepository({ transaction: trx });
    await repo.findById('t-1');
    expect(recorded.calls[0]!.wheres).toEqual([
      ['deletedAt', 'is', null],
      ['id', '=', 't-1'],
    ]);
  });

  it('softDelete updates deletedAt only for live rows', async () => {
    const repo = createTenantsRepository({ transaction: trx });
    await repo.softDelete('t-1');
    const call = recorded.calls[0]!;
    expect(call.kind).toBe('update');
    expect(call.setValues).toHaveProperty('deletedAt');
    expect(call.wheres).toEqual([
      ['id', '=', 't-1'],
      ['deletedAt', 'is', null],
    ]);
  });

  it('exposes the bound table name as runtime metadata', () => {
    const repo = createTenantsRepository({ transaction: trx });
    expect(repo.table).toBe('tenants');
  });
});
