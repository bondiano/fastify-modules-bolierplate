import type { SelectQueryBuilder } from 'kysely';

import type { Trx } from './transaction.js';

/**
 * Applies an ILIKE search across multiple columns using OR.
 *
 * This is a building block for simple search. For advanced full-text search
 * (tsvector/tsquery), build custom queries in the module's repository.
 *
 * @example
 * ```ts
 * // In a custom repository method:
 * findFiltered: async ({ search, ...opts }) => {
 *   let query = trx.selectFrom('posts').selectAll();
 *   if (search) {
 *     query = applySearch(query, trx, search, ['title', 'content']);
 *   }
 *   return await query.execute();
 * }
 * ```
 */
export const applySearch = <DB, T extends keyof DB & string, O>(
  query: SelectQueryBuilder<DB, T, O>,
  trx: Trx<DB>,
  search: string,
  columns: string[],
): SelectQueryBuilder<DB, T, O> => {
  if (columns.length === 0 || !search.trim()) return query;

  const pattern = `%${search}%`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicTrx = trx as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return query.where((eb: any) =>
    eb.or(
      columns.map((col: string) =>
        eb(dynamicTrx.dynamic.ref(col), 'ilike', pattern),
      ),
    ),
  );
};
