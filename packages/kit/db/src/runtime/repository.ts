import type { Insertable, Selectable, Updateable } from 'kysely';

import type { Trx } from './transaction.js';

/** Aliased expression returned by `r.fn.count(col).as(alias)`. */
export interface AliasedCountExpression {
  as: (alias: string) => unknown;
}

/** Minimal type for Kysely's `select(r => r.fn.count(...).as(...))` callback parameter. */
export interface CountExpressionBuilder {
  fn: { count: (col: unknown) => AliasedCountExpression };
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
}

export interface PageBasedPaginationOptions {
  page?: number;
  limit?: number;
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
}

export interface Paginated<T> {
  data: T[];
  count: number;
  limit: number;
  offset: number;
}

/**
 * Page-based paginated result aligned with `@kit/schemas` pagination.
 * Use with `calculatePagination(page, limit, total)` to build response metadata.
 */
export interface PaginatedPage<T> {
  items: T[];
  total: number;
}

export interface BaseRepository<DB, T extends keyof DB & string> {
  /**
   * Table name this repository is bound to. Exposed as runtime metadata so
   * cross-cutting tooling (e.g. `@kit/admin` auto-discovery) can bridge the
   * compile-time `DB[T]` generics to a concrete table at runtime without an
   * extra registration step.
   */
  readonly table: T;
  findById(id: string): Promise<Selectable<DB[T]> | undefined>;
  findByIdOrThrow(id: string): Promise<Selectable<DB[T]>>;
  findAll(): Promise<Selectable<DB[T]>[]>;
  findPaginated(
    options?: PaginationOptions,
  ): Promise<Paginated<Selectable<DB[T]>>>;
  /** Page-based pagination aligned with `@kit/schemas`. Returns `{ items, total }`. */
  findPaginatedByPage(
    options?: PageBasedPaginationOptions,
  ): Promise<PaginatedPage<Selectable<DB[T]>>>;
  create(data: Insertable<DB[T]>): Promise<Selectable<DB[T]>>;
  update(
    id: string,
    data: Updateable<DB[T]>,
  ): Promise<Selectable<DB[T]> | undefined>;
  deleteById(id: string): Promise<Selectable<DB[T]> | undefined>;
  count(): Promise<number>;
}

/**
 * Generic base repository built on top of a Kysely transaction proxy.
 *
 * Why it takes `Trx<DB>` instead of a raw `Kysely<DB>`: every call routes
 * through the AsyncLocalStorage-backed proxy, so repositories automatically
 * participate in an ambient transaction if one is active, and fall back to
 * the root connection otherwise -- no manual plumbing needed at call sites.
 *
 * Assumes tables expose an `id` column. For tables with composite or
 * non-`id` primary keys, build a bespoke repository instead of extending this.
 */
export const createBaseRepository = <DB, T extends keyof DB & string>(
  transaction: Trx<DB>,
  tableName: T,
): BaseRepository<DB, T> => {
  // Kysely's deep generic types make a polymorphic base repo impossible to
  // express without `any`. Public surface area is fully typed via
  // `BaseRepository<DB, T>`; internally we treat the transaction as untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const table = tableName;

  return {
    table: tableName,

    findById: async (id) => {
      return await trx
        .selectFrom(table)
        .selectAll()
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst();
    },

    findByIdOrThrow: async (id) => {
      return await trx
        .selectFrom(table)
        .selectAll()
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirstOrThrow();
    },

    findAll: async () => {
      return await trx.selectFrom(table).selectAll().execute();
    },

    findPaginated: async (options = {}) => {
      const {
        limit = 50,
        offset = 0,
        orderByField,
        orderByDirection = 'desc',
      } = options;

      let query = trx.selectFrom(table).selectAll().limit(limit).offset(offset);
      if (orderByField) {
        query = query.orderBy(trx.dynamic.ref(orderByField), orderByDirection);
      }

      const [data, countRow] = await Promise.all([
        query.execute(),
        trx
          .selectFrom(table)
          .select((r: CountExpressionBuilder) =>
            r.fn.count(trx.dynamic.ref('id')).as('count'),
          )
          .executeTakeFirstOrThrow(),
      ]);

      return { data, count: Number(countRow.count), limit, offset };
    },

    findPaginatedByPage: async (options = {}) => {
      const {
        page = 1,
        limit = 20,
        orderByField,
        orderByDirection = 'desc',
      } = options;
      const offset = (page - 1) * limit;

      let query = trx.selectFrom(table).selectAll().limit(limit).offset(offset);
      if (orderByField) {
        query = query.orderBy(trx.dynamic.ref(orderByField), orderByDirection);
      }

      const [items, countRow] = await Promise.all([
        query.execute(),
        trx
          .selectFrom(table)
          .select((r: CountExpressionBuilder) =>
            r.fn.count(trx.dynamic.ref('id')).as('count'),
          )
          .executeTakeFirstOrThrow(),
      ]);

      return { items, total: Number(countRow.count) };
    },

    create: async (data) => {
      return await trx
        .insertInto(table)
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    update: async (id, data) => {
      return await trx
        .updateTable(table)
        .set(data)
        .where(trx.dynamic.ref('id'), '=', id)
        .returningAll()
        .executeTakeFirst();
    },

    deleteById: async (id) => {
      return await trx
        .deleteFrom(table)
        .where(trx.dynamic.ref('id'), '=', id)
        .returningAll()
        .executeTakeFirst();
    },

    count: async () => {
      const row = await trx
        .selectFrom(table)
        .select((r: CountExpressionBuilder) =>
          r.fn.count(trx.dynamic.ref('id')).as('count'),
        )
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
  };
};
