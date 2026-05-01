import type { Insertable, Selectable, Updateable } from 'kysely';

import {
  createBaseRepository,
  createSoftDeleteRepository,
  type BaseRepository,
  type CountExpressionBuilder,
  type PageBasedPaginationOptions,
  type Paginated,
  type PaginatedPage,
  type PaginationOptions,
  type SoftDeleteRepository,
  type SoftDeleteRepositoryOptions,
  type Trx,
} from '@kit/db/runtime';

import type { TenantContext } from './context.js';

/**
 * Public surface of a tenant-scoped repository. The `TenantColumn` generic
 * narrows `create()` so callers cannot pass a tenant id (the column is
 * stamped from the active frame at runtime). Update payloads are also
 * stripped of the column at runtime regardless of caller intent.
 */
export interface TenantScopedRepository<
  DB,
  T extends keyof DB & string,
  TenantColumn extends string = 'tenantId',
> extends Omit<BaseRepository<DB, T>, 'create' | 'update'> {
  create(
    data: Omit<Insertable<DB[T]>, TenantColumn>,
  ): Promise<Selectable<DB[T]>>;
  update(
    id: string,
    data: Omit<Updateable<DB[T]>, TenantColumn>,
  ): Promise<Selectable<DB[T]> | undefined>;
  /**
   * Escape hatch: returns the underlying unfiltered repository. Use only
   * for system-admin views, cross-tenant analytics, and data migrations.
   * Forgetting to call `unscoped()` in those contexts silently returns an
   * empty list (not an error) once `tenant_id` is NOT NULL.
   */
  unscoped(): BaseRepository<DB, T>;
}

/** Soft-delete variant of `TenantScopedRepository`. */
export interface TenantScopedSoftDeleteRepository<
  DB,
  T extends keyof DB & string,
  TenantColumn extends string = 'tenantId',
> extends Omit<SoftDeleteRepository<DB, T>, 'create' | 'update'> {
  create(
    data: Omit<Insertable<DB[T]>, TenantColumn>,
  ): Promise<Selectable<DB[T]>>;
  update(
    id: string,
    data: Omit<Updateable<DB[T]>, TenantColumn>,
  ): Promise<Selectable<DB[T]> | undefined>;
  unscoped(): SoftDeleteRepository<DB, T>;
}

export interface TenantScopedRepositoryOptions<
  DB,
  T extends keyof DB & string,
> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
  readonly tableName: T;
  /** Column storing the tenant id. Defaults to `'tenantId'`. */
  readonly tenantColumn?: string;
}

export interface TenantScopedSoftDeleteRepositoryOptions<
  DB,
  T extends keyof DB & string,
>
  extends TenantScopedRepositoryOptions<DB, T>, SoftDeleteRepositoryOptions {}

const stripTenantColumn = <T extends Record<string, unknown>>(
  tenantColumn: string,
  data: T,
): T => {
  if (!(tenantColumn in data)) return data;
  const copy = { ...data };
  delete copy[tenantColumn];
  return copy;
};

/**
 * Creates a tenant-scoped reshape of the base repository.
 *
 * - Reads: injects `WHERE tenant_id = :current` on every select/count.
 * - Creates: stamps `tenant_id = :current` onto the insert values.
 * - Updates: strips `tenant_id` from the payload (defence in depth -- the
 *   public type already forbids it) and scopes the WHERE to the current
 *   tenant, so an attacker inside tenant A cannot rewrite a row to tenant B.
 * - Deletes: scoped to the current tenant.
 *
 * The `tenantContext` frame must be active at call time; otherwise
 * `TenantNotResolved` is thrown. Use `unscoped()` from system-admin or
 * cross-tenant analytics code paths.
 */
export const createTenantScopedRepository = <DB, T extends keyof DB & string>(
  options: TenantScopedRepositoryOptions<DB, T>,
): TenantScopedRepository<DB, T> => {
  const { transaction, tenantContext, tableName } = options;
  const tenantColumn = options.tenantColumn ?? 'tenantId';
  const unscoped = createBaseRepository<DB, T>(transaction, tableName);

  // Kysely's deep generic types make a polymorphic tenant-filter impossible
  // to express without `any`. Public surface stays fully typed via
  // `TenantScopedRepository<DB, T>`; internally we treat the transaction as
  // untyped -- same pattern as `@kit/db`'s `createBaseRepository`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const currentTenantId = (): string => tenantContext.currentTenant().tenantId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereTenant = (query: any) =>
    query.where(trx.dynamic.ref(tenantColumn), '=', currentTenantId());

  const buildPaginated = async (
    opts: PaginationOptions,
  ): Promise<Paginated<Selectable<DB[T]>>> => {
    const {
      limit = 50,
      offset = 0,
      orderByField,
      orderByDirection = 'desc',
    } = opts;

    let query = whereTenant(trx.selectFrom(tableName).selectAll())
      .limit(limit)
      .offset(offset);
    if (orderByField) {
      query = query.orderBy(trx.dynamic.ref(orderByField), orderByDirection);
    }

    const [data, countRow] = await Promise.all([
      query.execute(),
      whereTenant(trx.selectFrom(tableName))
        .select((r: CountExpressionBuilder) =>
          r.fn.count(trx.dynamic.ref('id')).as('count'),
        )
        .executeTakeFirstOrThrow(),
    ]);

    return { data, count: Number(countRow.count), limit, offset };
  };

  return {
    table: tableName,

    findById: async (id) =>
      await whereTenant(trx.selectFrom(tableName).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst(),

    findByIdOrThrow: async (id) =>
      await whereTenant(trx.selectFrom(tableName).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirstOrThrow(),

    findAll: async () =>
      await whereTenant(trx.selectFrom(tableName).selectAll()).execute(),

    findPaginated: async (opts = {}) => buildPaginated(opts),

    findPaginatedByPage: async (
      opts: PageBasedPaginationOptions = {},
    ): Promise<PaginatedPage<Selectable<DB[T]>>> => {
      const {
        page = 1,
        limit = 20,
        orderByField,
        orderByDirection = 'desc',
      } = opts;
      const offset = (page - 1) * limit;
      const paginationOpts: PaginationOptions = {
        limit,
        offset,
        orderByDirection,
      };
      if (orderByField) paginationOpts.orderByField = orderByField;
      const result = await buildPaginated(paginationOpts);
      return { items: result.data, total: result.count };
    },

    create: async (data) => {
      const values = {
        ...data,
        [tenantColumn]: currentTenantId(),
      };
      return await trx
        .insertInto(tableName)
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    update: async (id, data) => {
      const safe = stripTenantColumn(
        tenantColumn,
        data as Record<string, unknown>,
      );
      return await whereTenant(
        trx
          .updateTable(tableName)
          .set(safe)
          .where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst();
    },

    deleteById: async (id) =>
      await whereTenant(
        trx.deleteFrom(tableName).where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    count: async () => {
      const row = await whereTenant(trx.selectFrom(tableName))
        .select((r: CountExpressionBuilder) =>
          r.fn.count(trx.dynamic.ref('id')).as('count'),
        )
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    unscoped: () => unscoped,
  };
};

/**
 * Tenant-scoped reshape of the soft-delete repository. Applies both the
 * tenant filter and the `deletedAt IS NULL` filter on every read; writes
 * honour both scopes too.
 */
export const createTenantScopedSoftDeleteRepository = <
  DB,
  T extends keyof DB & string,
>(
  options: TenantScopedSoftDeleteRepositoryOptions<DB, T>,
): TenantScopedSoftDeleteRepository<DB, T> => {
  const { transaction, tenantContext, tableName } = options;
  const tenantColumn = options.tenantColumn ?? 'tenantId';
  const deletedAtColumn = options.deletedAtColumn ?? 'deletedAt';
  const unscopedOptions: SoftDeleteRepositoryOptions = { deletedAtColumn };
  const unscoped = createSoftDeleteRepository<DB, T>(
    transaction,
    tableName,
    unscopedOptions,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const currentTenantId = (): string => tenantContext.currentTenant().tenantId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereTenant = (query: any) =>
    query.where(trx.dynamic.ref(tenantColumn), '=', currentTenantId());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notDeleted = (query: any) =>
    query.where(trx.dynamic.ref(deletedAtColumn), 'is', null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = (query: any) => notDeleted(whereTenant(query));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scopedAll = (query: any) => whereTenant(query);

  const buildPaginated = async (
    opts: PaginationOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilter: (q: any) => any,
  ): Promise<Paginated<Selectable<DB[T]>>> => {
    const {
      limit = 50,
      offset = 0,
      orderByField,
      orderByDirection = 'desc',
    } = opts;

    let query = applyFilter(trx.selectFrom(tableName).selectAll())
      .limit(limit)
      .offset(offset);
    if (orderByField) {
      query = query.orderBy(trx.dynamic.ref(orderByField), orderByDirection);
    }

    const [data, countRow] = await Promise.all([
      query.execute(),
      applyFilter(trx.selectFrom(tableName))
        .select((r: CountExpressionBuilder) =>
          r.fn.count(trx.dynamic.ref('id')).as('count'),
        )
        .executeTakeFirstOrThrow(),
    ]);

    return { data, count: Number(countRow.count), limit, offset };
  };

  return {
    table: tableName,

    findById: async (id) =>
      await active(trx.selectFrom(tableName).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst(),

    findByIdOrThrow: async (id) =>
      await active(trx.selectFrom(tableName).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirstOrThrow(),

    findAll: async () =>
      await active(trx.selectFrom(tableName).selectAll()).execute(),

    findPaginated: async (opts = {}) => buildPaginated(opts, active),

    findPaginatedByPage: async (
      opts: PageBasedPaginationOptions = {},
    ): Promise<PaginatedPage<Selectable<DB[T]>>> => {
      const {
        page = 1,
        limit = 20,
        orderByField,
        orderByDirection = 'desc',
      } = opts;
      const offset = (page - 1) * limit;
      const paginationOpts: PaginationOptions = {
        limit,
        offset,
        orderByDirection,
      };
      if (orderByField) paginationOpts.orderByField = orderByField;
      const result = await buildPaginated(paginationOpts, active);
      return { items: result.data, total: result.count };
    },

    count: async () => {
      const row = await active(trx.selectFrom(tableName))
        .select((r: CountExpressionBuilder) =>
          r.fn.count(trx.dynamic.ref('id')).as('count'),
        )
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    findByIdIncludingDeleted: async (id) =>
      await whereTenant(trx.selectFrom(tableName).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst(),

    findAllIncludingDeleted: async () =>
      await whereTenant(trx.selectFrom(tableName).selectAll()).execute(),

    findPaginatedIncludingDeleted: async (opts = {}) =>
      buildPaginated(opts, scopedAll),

    create: async (data) => {
      const values = {
        ...data,
        [tenantColumn]: currentTenantId(),
      };
      return await trx
        .insertInto(tableName)
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    update: async (id, data) => {
      const safe = stripTenantColumn(
        tenantColumn,
        data as Record<string, unknown>,
      );
      return await active(
        trx
          .updateTable(tableName)
          .set(safe)
          .where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst();
    },

    deleteById: async (id) =>
      await active(
        trx
          .updateTable(tableName)
          .set({
            [deletedAtColumn]: new Date().toISOString(),
          } as Updateable<DB[T]>)
          .where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    softDelete: async (id) =>
      await active(
        trx
          .updateTable(tableName)
          .set({
            [deletedAtColumn]: new Date().toISOString(),
          } as Updateable<DB[T]>)
          .where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    restore: async (id) =>
      await whereTenant(
        trx
          .updateTable(tableName)
          .set({ [deletedAtColumn]: null } as Updateable<DB[T]>)
          .where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    hardDeleteById: async (id) =>
      await whereTenant(
        trx.deleteFrom(tableName).where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    unscoped: () => unscoped,
  };
};
