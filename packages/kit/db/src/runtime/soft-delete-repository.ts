import type { Selectable, Updateable } from 'kysely';

import type {
  BaseRepository,
  CountExpressionBuilder,
  Paginated,
  PaginationOptions,
} from './repository.js';
import type { Trx } from './transaction.js';

export interface SoftDeleteRepository<
  DB,
  T extends keyof DB & string,
> extends BaseRepository<DB, T> {
  /** Alias for deleteById -- sets `deletedAt` to now. */
  softDelete(id: string): Promise<Selectable<DB[T]> | undefined>;
  /** Restores a soft-deleted record by clearing `deletedAt`. */
  restore(id: string): Promise<Selectable<DB[T]> | undefined>;
  /** Permanently removes the record from the database. */
  hardDeleteById(id: string): Promise<Selectable<DB[T]> | undefined>;
  /** Find by ID without filtering deleted records. */
  findByIdIncludingDeleted(id: string): Promise<Selectable<DB[T]> | undefined>;
  /** Find all without filtering deleted records. */
  findAllIncludingDeleted(): Promise<Selectable<DB[T]>[]>;
  /** Paginated query without filtering deleted records (offset-based). */
  findPaginatedIncludingDeleted(
    options?: PaginationOptions,
  ): Promise<Paginated<Selectable<DB[T]>>>;
}

export interface SoftDeleteRepositoryOptions {
  /** Column name for the soft-delete timestamp. Defaults to `'deletedAt'`. */
  deletedAtColumn?: string;
}

/**
 * Creates a repository with soft-delete support.
 *
 * All read queries filter out records where `deletedAt IS NOT NULL` by default.
 * `deleteById` performs a soft delete (sets `deletedAt` to now).
 * Use `hardDeleteById` for permanent removal.
 * Use `*IncludingDeleted` methods to bypass the soft-delete filter.
 *
 * Assumes the table has `id` and `deletedAt` (or custom) columns.
 */
export const createSoftDeleteRepository = <DB, T extends keyof DB & string>(
  transaction: Trx<DB>,
  tableName: T,
  options?: SoftDeleteRepositoryOptions,
): SoftDeleteRepository<DB, T> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const table = tableName;
  const deletedAtCol = options?.deletedAtColumn ?? 'deletedAt';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notDeleted = (query: any) =>
    query.where(trx.dynamic.ref(deletedAtCol), 'is', null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildCount = (applyFilter: (q: any) => any) =>
    applyFilter(trx.selectFrom(table))
      .select((r: CountExpressionBuilder) =>
        r.fn.count(trx.dynamic.ref('id')).as('count'),
      )
      .executeTakeFirstOrThrow();

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

    let query = applyFilter(trx.selectFrom(table).selectAll())
      .limit(limit)
      .offset(offset);
    if (orderByField) {
      query = query.orderBy(trx.dynamic.ref(orderByField), orderByDirection);
    }

    const [data, countRow] = await Promise.all([
      query.execute(),
      buildCount(applyFilter),
    ]);

    return { data, count: Number(countRow.count), limit, offset };
  };

  return {
    table: tableName,

    // --- Reads (filtered) ---

    findById: async (id) =>
      await notDeleted(trx.selectFrom(table).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst(),

    findByIdOrThrow: async (id) =>
      await notDeleted(trx.selectFrom(table).selectAll())
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirstOrThrow(),

    findAll: async () =>
      await notDeleted(trx.selectFrom(table).selectAll()).execute(),

    findPaginated: async (opts = {}) => buildPaginated(opts, notDeleted),

    findPaginatedByPage: async (opts = {}) => {
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
      const result = await buildPaginated(paginationOpts, notDeleted);
      return { items: result.data, total: result.count };
    },

    count: async () => {
      const row = await buildCount(notDeleted);
      return Number(row.count);
    },

    // --- Reads (unfiltered) ---

    findByIdIncludingDeleted: async (id) =>
      await trx
        .selectFrom(table)
        .selectAll()
        .where(trx.dynamic.ref('id'), '=', id)
        .executeTakeFirst(),

    findAllIncludingDeleted: async () =>
      await trx.selectFrom(table).selectAll().execute(),

    findPaginatedIncludingDeleted: async (opts = {}) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildPaginated(opts, (q: any) => q),

    // --- Writes ---

    create: async (data) =>
      await trx
        .insertInto(table)
        .values(data)
        .returningAll()
        .executeTakeFirstOrThrow(),

    update: async (id, data) =>
      await notDeleted(
        trx.updateTable(table).set(data).where(trx.dynamic.ref('id'), '=', id),
      )
        .returningAll()
        .executeTakeFirst(),

    deleteById: async (id) =>
      await trx
        .updateTable(table)
        .set({ [deletedAtCol]: new Date().toISOString() } as Updateable<DB[T]>)
        .where(trx.dynamic.ref('id'), '=', id)
        .where(trx.dynamic.ref(deletedAtCol), 'is', null)
        .returningAll()
        .executeTakeFirst(),

    softDelete: async (id) =>
      await trx
        .updateTable(table)
        .set({ [deletedAtCol]: new Date().toISOString() } as Updateable<DB[T]>)
        .where(trx.dynamic.ref('id'), '=', id)
        .where(trx.dynamic.ref(deletedAtCol), 'is', null)
        .returningAll()
        .executeTakeFirst(),

    restore: async (id) =>
      await trx
        .updateTable(table)
        .set({ [deletedAtCol]: null } as Updateable<DB[T]>)
        .where(trx.dynamic.ref('id'), '=', id)
        .returningAll()
        .executeTakeFirst(),

    hardDeleteById: async (id) =>
      await trx
        .deleteFrom(table)
        .where(trx.dynamic.ref('id'), '=', id)
        .returningAll()
        .executeTakeFirst(),
  };
};
