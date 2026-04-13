import type { AsyncLocalStorage } from 'node:async_hooks';

import type { IsolationLevel, Kysely, Transaction } from 'kysely';

type Callback<T> = () => Promise<T>;

/**
 * Callable transaction proxy: also exposes all Kysely query-builder methods
 * via the proxy trap, routing them to the active transaction (from
 * AsyncLocalStorage) or the root data source.
 */
export interface Trx<DB> extends Transaction<DB> {
  <T>(callback: Callback<T>): Promise<T>;
  <T>(isolationLevel: IsolationLevel, callback: Callback<T>): Promise<T>;
}

export type TransactionStorage<DB> = AsyncLocalStorage<Transaction<DB>>;

export interface CreateTransactionFactoryOptions<DB> {
  dataSource: Kysely<DB>;
  transactionStorage: TransactionStorage<DB>;
}

/**
 * Builds the callable `transaction` proxy.
 *
 * - Calling `transaction(cb)` starts a new Kysely transaction and runs `cb`
 *   inside AsyncLocalStorage, making the inner transaction globally available
 *   to anything that reads `transactionStorage.getStore()`.
 * - Calling `transaction(level, cb)` sets the isolation level first.
 * - Nested `transaction(cb)` calls reuse the ambient transaction instead of
 *   opening a new one -- this enables transparent composition across services.
 * - Accessing any Kysely method on the proxy (e.g. `transaction.selectFrom`)
 *   dispatches to the ambient transaction if one exists, otherwise to the
 *   root data source.
 */
function proxyTarget() {}

export function createTransactionFactory<DB>({
  dataSource,
  transactionStorage,
}: CreateTransactionFactoryOptions<DB>): Trx<DB> {
  async function runTransaction<T>(
    isolationLevelOrCallback: IsolationLevel | Callback<T>,
    callback?: Callback<T>,
  ): Promise<T> {
    const isolationLevel = callback
      ? (isolationLevelOrCallback as IsolationLevel)
      : undefined;
    const fn = callback ?? (isolationLevelOrCallback as Callback<T>);

    const existing = transactionStorage.getStore();
    if (existing) {
      return await fn();
    }

    let builder = dataSource.transaction();
    if (isolationLevel) {
      builder = builder.setIsolationLevel(isolationLevel);
    }

    return await builder.execute((trx) => transactionStorage.run(trx, fn));
  }

  return new Proxy<Trx<DB>>(proxyTarget as unknown as Trx<DB>, {
    apply(_target, _this, argumentsList: Parameters<typeof runTransaction>) {
      return runTransaction(...argumentsList);
    },
    get(_target, property: string | symbol) {
      const active = (transactionStorage.getStore() ??
        dataSource) as unknown as Record<string | symbol, unknown>;
      const value = active[property];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(active);
      }
      return value;
    },
  });
}

/**
 * This should be the only place where AsyncLocalStorage is imported and
 * instantiated. Multiple instances (easy to create with vitest's module
 * isolation) cause transactions to silently stop propagating in tests.
 */
export async function createTransactionStorage<DB>(): Promise<
  TransactionStorage<DB>
> {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return new AsyncLocalStorage<Transaction<DB>>();
}
