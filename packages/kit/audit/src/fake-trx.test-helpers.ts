import type { Trx } from '@kit/db/runtime';

/**
 * Lifted from `@kit/tenancy/src/fake-trx.test-helpers.ts` -- a hand-rolled
 * Kysely query recorder used by the unit tests so we don't pay the PGlite
 * spin-up tax for every assertion. Integration coverage lives in
 * `integration.test.ts`.
 */

export interface QueryCall {
  table: string;
  kind: 'select' | 'insert' | 'update' | 'delete';
  wheres: Array<[string, string, unknown]>;
  values?: Record<string, unknown> | Record<string, unknown>[];
  setValues?: Record<string, unknown>;
  orderBy?: { field: string; direction: string };
  limit?: number;
  offset?: number;
  selections: string[];
  /** Set when the query attached a `.returning(...)` or `.returningAll()`
   * clause. The fake `execute()` uses this to switch from the
   * count-shaped `[{ numDeletedRows }]` payload to a per-row payload. */
  hasReturning?: boolean;
}

export interface Recorded {
  calls: QueryCall[];
  resultForExecute: unknown[];
  resultForSingle: unknown;
  countValue: number;
  updateCount: number;
  deleteCount: number;
}

export const freshRecorded = (): Recorded => ({
  calls: [],
  resultForExecute: [],
  resultForSingle: undefined,
  countValue: 0,
  updateCount: 0,
  deleteCount: 0,
});

export const buildFakeTrx = <DB>(recorded: Recorded): Trx<DB> => {
  const makeBuilder = (call: QueryCall) => {
    const builder: Record<string, unknown> = {
      where(col: unknown, op: string, value: unknown) {
        const colName =
          typeof col === 'string' ? col : (col as { col: string }).col;
        call.wheres.push([colName, op, value]);
        return builder;
      },
      selectAll() {
        call.selections.push('*');
        return builder;
      },
      select(callback: (b: unknown) => unknown) {
        const countToken = { as: (alias: string) => `count:${alias}` };
        callback({ fn: { count: (_c: unknown) => countToken } });
        call.selections.push('count');
        return builder;
      },
      values(v: Record<string, unknown> | Record<string, unknown>[]) {
        call.values = v;
        return builder;
      },
      set(v: Record<string, unknown>) {
        call.setValues = v;
        return builder;
      },
      returningAll() {
        call.hasReturning = true;
        return builder;
      },
      returning(_field: unknown) {
        call.hasReturning = true;
        return builder;
      },
      orderBy(field: unknown, direction: string) {
        const name =
          typeof field === 'string' ? field : (field as { col: string }).col;
        call.orderBy = { field: name, direction };
        return builder;
      },
      limit(n: number) {
        call.limit = n;
        return builder;
      },
      offset(n: number) {
        call.offset = n;
        return builder;
      },
      async execute() {
        if (call.kind === 'update') {
          return [{ numUpdatedRows: recorded.updateCount }];
        }
        if (call.kind === 'delete') {
          // With `.returning(...)`, callers expect one row per deleted
          // record; without, they expect a count-shaped result.
          if (call.hasReturning) {
            return Array.from({ length: recorded.deleteCount }, () => ({}));
          }
          return [{ numDeletedRows: recorded.deleteCount }];
        }
        return recorded.resultForExecute;
      },
      async executeTakeFirst() {
        if (call.kind === 'delete') {
          return { numDeletedRows: recorded.deleteCount };
        }
        return recorded.resultForSingle;
      },
      async executeTakeFirstOrThrow() {
        if (call.selections.includes('count')) {
          return { count: recorded.countValue };
        }
        if (recorded.resultForSingle === undefined) {
          throw new Error('not found');
        }
        return recorded.resultForSingle;
      },
    };
    return builder;
  };

  const dynamic = {
    ref: (col: string) => ({ col }),
  };

  const trx = {
    dynamic,
    selectFrom(table: string) {
      const call: QueryCall = {
        table,
        kind: 'select',
        wheres: [],
        selections: [],
      };
      recorded.calls.push(call);
      return makeBuilder(call);
    },
    insertInto(table: string) {
      const call: QueryCall = {
        table,
        kind: 'insert',
        wheres: [],
        selections: [],
      };
      recorded.calls.push(call);
      return makeBuilder(call);
    },
    updateTable(table: string) {
      const call: QueryCall = {
        table,
        kind: 'update',
        wheres: [],
        selections: [],
      };
      recorded.calls.push(call);
      return makeBuilder(call);
    },
    deleteFrom(table: string) {
      const call: QueryCall = {
        table,
        kind: 'delete',
        wheres: [],
        selections: [],
      };
      recorded.calls.push(call);
      return makeBuilder(call);
    },
  };

  return trx as unknown as Trx<DB>;
};
