import type { Updateable } from 'kysely';

import type { Trx } from './transaction.js';

export interface BulkOperations<DB, T extends keyof DB & string> {
  /** Delete multiple records by IDs. Returns the count of deleted records. */
  bulkDelete(ids: string[]): Promise<number>;
  /** Update multiple records by IDs with the same data. Returns the count of updated records. */
  bulkUpdate(ids: string[], data: Updateable<DB[T]>): Promise<number>;
}

export interface SoftDeleteBulkOperations<
  DB,
  T extends keyof DB & string,
> extends BulkOperations<DB, T> {
  /** Permanently delete multiple records. Returns the count of deleted records. */
  bulkHardDelete(ids: string[]): Promise<number>;
}

/**
 * Creates bulk operations for tables with hard delete.
 */
export const createBulkOperations = <DB, T extends keyof DB & string>(
  transaction: Trx<DB>,
  tableName: T,
): BulkOperations<DB, T> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const table = tableName;

  return {
    bulkDelete: async (ids) => {
      if (ids.length === 0) return 0;
      const result = await trx
        .deleteFrom(table)
        .where(trx.dynamic.ref('id'), 'in', ids)
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    bulkUpdate: async (ids, data) => {
      if (ids.length === 0) return 0;
      const result = await trx
        .updateTable(table)
        .set(data)
        .where(trx.dynamic.ref('id'), 'in', ids)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },
  };
};

/**
 * Creates bulk operations for tables with soft delete.
 * `bulkDelete` sets `deletedAt` to now instead of removing records.
 * `bulkHardDelete` permanently removes records.
 */
export const createSoftDeleteBulkOperations = <DB, T extends keyof DB & string>(
  transaction: Trx<DB>,
  tableName: T,
  options?: { deletedAtColumn?: string },
): SoftDeleteBulkOperations<DB, T> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const table = tableName;
  const deletedAtCol = options?.deletedAtColumn ?? 'deletedAt';

  return {
    bulkDelete: async (ids) => {
      if (ids.length === 0) return 0;
      const result = await trx
        .updateTable(table)
        .set({ [deletedAtCol]: new Date().toISOString() } as Updateable<DB[T]>)
        .where(trx.dynamic.ref('id'), 'in', ids)
        .where(trx.dynamic.ref(deletedAtCol), 'is', null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    bulkUpdate: async (ids, data) => {
      if (ids.length === 0) return 0;
      const result = await trx
        .updateTable(table)
        .set(data)
        .where(trx.dynamic.ref('id'), 'in', ids)
        .where(trx.dynamic.ref(deletedAtCol), 'is', null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    bulkHardDelete: async (ids) => {
      if (ids.length === 0) return 0;
      const result = await trx
        .deleteFrom(table)
        .where(trx.dynamic.ref('id'), 'in', ids)
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
};
