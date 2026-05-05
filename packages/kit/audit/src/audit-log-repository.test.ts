import { beforeEach, describe, expect, it } from 'vitest';

import type { Trx } from '@kit/db/runtime';
import {
  createTenantContext,
  createTenantStorage,
  TenantNotResolved,
  type TenantContext,
  type TenantStorage,
} from '@kit/tenancy';

import {
  createAuditLogRepository,
  type AuditLogInsert,
} from './audit-log-repository.js';
import {
  buildFakeTrx,
  freshRecorded,
  type Recorded,
} from './fake-trx.test-helpers.js';
import type { AuditDB } from './schema.js';

describe('createAuditLogRepository', () => {
  let storage: TenantStorage;
  let tenantContext: TenantContext;
  let recorded: Recorded;
  let trx: Trx<AuditDB>;

  beforeEach(() => {
    storage = createTenantStorage();
    tenantContext = createTenantContext({ tenantStorage: storage });
    recorded = freshRecorded();
    trx = buildFakeTrx<AuditDB>(recorded);
  });

  describe('reads (tenant-scoped via @kit/tenancy)', () => {
    it('findById injects WHERE tenant_id = :current', async () => {
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await tenantContext.withTenant('t-1', async () => {
        await repo.findById('a-1');
      });
      expect(recorded.calls[0]!.wheres).toEqual([
        ['tenant_id', '=', 't-1'],
        ['id', '=', 'a-1'],
      ]);
    });

    it('findPaginatedByPage scopes both legs to current tenant', async () => {
      recorded.countValue = 0;
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await tenantContext.withTenant('t-1', async () => {
        await repo.findPaginatedByPage({ page: 2, limit: 10 });
      });
      // Two select calls: list + count, both filtered by tenant_id.
      expect(recorded.calls).toHaveLength(2);
      for (const call of recorded.calls) {
        expect(call.kind).toBe('select');
        expect(call.wheres).toContainEqual(['tenant_id', '=', 't-1']);
      }
    });

    it('reads outside any tenant frame throw TenantNotResolved', async () => {
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await expect(repo.findAll()).rejects.toBeInstanceOf(TenantNotResolved);
    });
  });

  describe('append (system-level, frame-less)', () => {
    it('inserts the entry verbatim with the explicit tenantId', async () => {
      recorded.resultForSingle = { id: 'a-1' };
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      const entry: AuditLogInsert<AuditDB> = {
        tenantId: 't-1',
        actorId: 'u-1',
        subjectType: 'Post',
        subjectId: 'p-1',
        action: 'create',
        diff: null,
        metadata: null,
        ip: '127.0.0.1',
        userAgent: 'vitest',
        correlationId: 'req-1',
        sensitive: false,
      };
      await repo.append(entry);
      const call = recorded.calls[0]!;
      expect(call.kind).toBe('insert');
      expect(call.table).toBe('audit_log');
      expect(call.values).toEqual(entry);
    });

    it('accepts a null tenantId for pre-tenant flows', async () => {
      recorded.resultForSingle = { id: 'a-1' };
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await repo.append({
        tenantId: null,
        actorId: null,
        subjectType: 'Auth',
        subjectId: 'register',
        action: 'auth.register',
        diff: null,
        metadata: null,
        ip: null,
        userAgent: null,
        correlationId: 'req-2',
        sensitive: false,
      });
      const call = recorded.calls[0]!;
      expect((call.values as Record<string, unknown>).tenantId).toBe(null);
    });

    it('does NOT require an active tenant frame', async () => {
      // Crucial property: append() must work outside any withTenant call so
      // the decorator can audit signup / password-reset routes.
      recorded.resultForSingle = { id: 'a-1' };
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await expect(
        repo.append({
          tenantId: 't-1',
          actorId: null,
          subjectType: 'X',
          subjectId: 'y',
          action: 'a',
          diff: null,
          metadata: null,
          ip: null,
          userAgent: null,
          correlationId: null,
          sensitive: false,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('appendMany (batched)', () => {
    it('emits a single INSERT with the full array as values', async () => {
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      const entries: AuditLogInsert<AuditDB>[] = [
        {
          tenantId: 't-1',
          actorId: 'u-1',
          subjectType: 'Post',
          subjectId: 'p-1',
          action: 'create',
          diff: null,
          metadata: null,
          ip: null,
          userAgent: null,
          correlationId: 'req-1',
          sensitive: false,
        },
        {
          tenantId: 't-1',
          actorId: 'u-1',
          subjectType: 'Post',
          subjectId: 'p-2',
          action: 'update',
          diff: null,
          metadata: null,
          ip: null,
          userAgent: null,
          correlationId: 'req-1',
          sensitive: false,
        },
      ];
      await repo.appendMany(entries);
      expect(recorded.calls).toHaveLength(1);
      const call = recorded.calls[0]!;
      expect(call.kind).toBe('insert');
      expect(call.values).toEqual(entries);
    });

    it('is a no-op on empty input (no SQL emitted)', async () => {
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await repo.appendMany([]);
      expect(recorded.calls).toHaveLength(0);
    });
  });

  describe('pruneOlderThan', () => {
    it('deletes rows with created_at < cutoff and returns the count', async () => {
      recorded.deleteCount = 17;
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      const cutoff = new Date('2026-01-01T00:00:00Z');
      const result = await repo.pruneOlderThan(cutoff);
      expect(result).toEqual({ deleted: 17 });

      const call = recorded.calls[0]!;
      expect(call.kind).toBe('delete');
      expect(call.table).toBe('audit_log');
      expect(call.wheres).toEqual([['created_at', '<', cutoff]]);
    });

    it('does NOT require a tenant frame (system-level)', async () => {
      recorded.deleteCount = 0;
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      await expect(repo.pruneOlderThan(new Date())).resolves.toEqual({
        deleted: 0,
      });
    });
  });

  describe('unscoped (escape hatch)', () => {
    it('returns a base repository with no tenant filter on reads', async () => {
      const repo = createAuditLogRepository({
        transaction: trx,
        tenantContext,
      });
      const base = repo.unscoped();
      await base.findById('a-1');
      expect(recorded.calls[0]!.wheres).toEqual([['id', '=', 'a-1']]);
    });
  });

  it('exposes the bound table name as runtime metadata', () => {
    const repo = createAuditLogRepository({
      transaction: trx,
      tenantContext,
    });
    expect(repo.table).toBe('audit_log');
  });
});
