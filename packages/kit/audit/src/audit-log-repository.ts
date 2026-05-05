import type { Insertable, Selectable } from 'kysely';

import type { BaseRepository, Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type { AuditDB } from './schema.js';

/**
 * Public shapes for inserts and rows. Parameterised on `DB` so the
 * canonical types track whatever the consumer's generated `DB` declares
 * for `audit_log` -- if a service post-processes the column types via
 * `kysely-codegen`, those overrides are visible here.
 */
export type AuditLogInsert<DB extends AuditDB> = Insertable<DB['audit_log']>;
export type AuditLogRow<DB extends AuditDB> = Selectable<DB['audit_log']>;

/**
 * The read-side surface inherited from `@kit/tenancy`'s scoped repo.
 * `create` / `update` / `deleteById` are intentionally omitted -- the
 * audit table is append-only; writes go through `append` /
 * `appendMany` (system-level, frame-less) and the only legal delete is
 * `pruneOlderThan` driven by the retention policy.
 */
type ReadSurface<DB extends AuditDB> = Pick<
  TenantScopedRepository<DB, 'audit_log'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
  | 'unscoped'
>;

/** Filter inputs accepted by `findFilteredAdmin`. Keys mirror what the
 * `@kit/admin` list route assembles from the request querystring after
 * resolving each declared `FilterSpec`. Empty strings / undefined values
 * are dropped before the call. */
export interface AuditFilterAdminOptions {
  readonly page: number;
  readonly limit: number;
  readonly orderBy?: string;
  readonly order?: 'asc' | 'desc';
  readonly search?: string;
  readonly filters: Readonly<Record<string, string>>;
}

export interface AuditLogRepository<
  DB extends AuditDB,
> extends ReadSurface<DB> {
  /** System-level append. Caller passes `tenantId` explicitly (may be
   * `null` for pre-tenant flows). Does NOT require an active tenant
   * frame -- this is what makes the decorator usable on
   * `withTenantBypass()` routes. */
  append(entry: AuditLogInsert<DB>): Promise<AuditLogRow<DB>>;

  /** Batched append used by the request-scoped buffer flush. Inserts in a
   * single round-trip; returns void because the decorator never reads them
   * back. Empty arrays are a no-op. */
  appendMany(entries: readonly AuditLogInsert<DB>[]): Promise<void>;

  /** Removes audit rows older than `cutoff`. Used by the `audit.prune`
   * BullMQ repeatable. */
  pruneOlderThan(cutoff: Date): Promise<{ deleted: number }>;

  /** Cross-tenant escape hatch: returns the underlying unfiltered base
   * repository. Use only from system-admin views, cross-tenant analytics,
   * or data migrations. */
  unscoped(): BaseRepository<DB, 'audit_log'>;

  /** Tenant-scoped filtered list used by `@kit/admin` for the audit-log
   * resource. Recognised filter keys: `actorId`, `subjectType`, `action`,
   * `createdAtFrom`, `createdAtTo`. Any other key is ignored. `search`
   * runs ILIKE over `subject_id` and `action` together. */
  findFilteredAdmin(opts: AuditFilterAdminOptions): Promise<{
    items: readonly AuditLogRow<DB>[];
    total: number;
  }>;

  /** Returns up to `limit` distinct non-null values for a column,
   * ordered ascending. Used by `@kit/admin`'s `options: 'distinct'`
   * filter materialisation at boot. Tenant-scoped on `tenant_id`. */
  distinctValues(column: string, limit?: number): Promise<readonly string[]>;
}

export interface AuditLogRepositoryDeps<DB extends AuditDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

/**
 * Creates the canonical `audit_log` repository. Composes
 * `@kit/tenancy`'s `createTenantScopedRepository` for the read path
 * (admin will always have a tenant frame when listing) and adds bespoke
 * `append` / `appendMany` / `pruneOlderThan` methods that bypass the
 * frame for the write path.
 */
export const createAuditLogRepository = <DB extends AuditDB>({
  transaction,
  tenantContext,
}: AuditLogRepositoryDeps<DB>): AuditLogRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'audit_log'>({
    transaction,
    tenantContext,
    tableName: 'audit_log',
    // Audit table uses snake_case at the runtime layer; consumers whose
    // generated `DB` camelCases it can override at the consumer level.
    tenantColumn: 'tenant_id',
  });

  // Kysely's deep generic types make a polymorphic raw INSERT impossible
  // to express without `any` at the boundary. Public surface is fully
  // typed via `AuditLogInsert<DB>` / `AuditLogRow<DB>`; internally we
  // treat the transaction as untyped -- same pattern as `@kit/db`'s
  // `createBaseRepository`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    table: scoped.table,
    findById: scoped.findById,
    findByIdOrThrow: scoped.findByIdOrThrow,
    findAll: scoped.findAll,
    findPaginated: scoped.findPaginated,
    findPaginatedByPage: scoped.findPaginatedByPage,
    count: scoped.count,
    unscoped: () => scoped.unscoped(),

    append: async (entry) =>
      await trx
        .insertInto('audit_log')
        .values(entry)
        .returningAll()
        .executeTakeFirstOrThrow(),

    appendMany: async (entries) => {
      if (entries.length === 0) return;
      await trx.insertInto('audit_log').values(entries).execute();
    },

    pruneOlderThan: async (cutoff) => {
      // Use `RETURNING id` and count the returned array rather than
      // trusting `numDeletedRows` from `.execute()` -- PGlite (the test
      // backend) returns `0n` for that field even on a successful
      // delete, masking real coverage. `RETURNING id` is reliable on
      // both Postgres and PGlite.
      const rows = await trx
        .deleteFrom('audit_log')
        .where(trx.dynamic.ref('created_at'), '<', cutoff)
        .returning('id')
        .execute();
      return { deleted: (rows as readonly unknown[]).length };
    },

    findFilteredAdmin: async (opts) => {
      const tenantId = tenantContext.currentTenant().tenantId;
      const offset = (opts.page - 1) * opts.limit;
      const filters = opts.filters;

      // Build both legs (data + count) from the same WHERE chain.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyWhere = (q: any) => {
        let next = q.where(trx.dynamic.ref('tenant_id'), '=', tenantId);
        if (filters['actorId']) {
          next = next.where(
            trx.dynamic.ref('actor_id'),
            '=',
            filters['actorId'],
          );
        }
        if (filters['subjectType']) {
          next = next.where(
            trx.dynamic.ref('subject_type'),
            '=',
            filters['subjectType'],
          );
        }
        if (filters['action']) {
          next = next.where(trx.dynamic.ref('action'), '=', filters['action']);
        }
        if (filters['createdAtFrom']) {
          next = next.where(
            trx.dynamic.ref('created_at'),
            '>=',
            new Date(filters['createdAtFrom']),
          );
        }
        if (filters['createdAtTo']) {
          // Inclusive end: bump to next day's 00:00.
          const to = new Date(filters['createdAtTo']);
          to.setUTCDate(to.getUTCDate() + 1);
          next = next.where(trx.dynamic.ref('created_at'), '<', to);
        }
        if (opts.search && opts.search.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          next = next.where((eb: any) =>
            eb.or([
              eb(trx.dynamic.ref('subject_id'), 'ilike', `%${opts.search}%`),
              eb(trx.dynamic.ref('action'), 'ilike', `%${opts.search}%`),
            ]),
          );
        }
        return next;
      };

      const orderBy = opts.orderBy ?? 'createdAt';
      const order = opts.order ?? 'desc';

      const [data, countRow] = await Promise.all([
        applyWhere(trx.selectFrom('audit_log').selectAll())
          .orderBy(trx.dynamic.ref(orderBy), order)
          .limit(opts.limit)
          .offset(offset)
          .execute(),
        applyWhere(trx.selectFrom('audit_log'))
          .select(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: any) => r.fn.count(trx.dynamic.ref('id')).as('count'),
          )
          .executeTakeFirstOrThrow(),
      ]);

      return {
        items: data as readonly AuditLogRow<DB>[],
        total: Number((countRow as { count: number | string }).count),
      };
    },

    distinctValues: async (column, limit = 50) => {
      const tenantId = tenantContext.currentTenant().tenantId;
      const rows = await trx
        .selectFrom('audit_log')
        .select(trx.dynamic.ref(column).as('value'))
        .where(trx.dynamic.ref('tenant_id'), '=', tenantId)
        .where(trx.dynamic.ref(column), 'is not', null)
        .distinct()
        .orderBy(trx.dynamic.ref(column), 'asc')
        .limit(limit)
        .execute();
      return rows
        .map((r: { value: unknown }) =>
          r.value === null || r.value === undefined ? '' : String(r.value),
        )
        .filter((v: string) => v.length > 0);
    },
  };
};
