import type { Kysely, Transaction } from 'kysely';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createTransactionFactory,
  createTransactionStorage,
  type TransactionStorage,
} from './transaction.js';

interface TestDB {
  invoices: { id: string };
}

describe('transaction proxy', () => {
  const txSelectFrom = vi.fn();
  const dsSelectFrom = vi.fn();
  const execute = vi
    .fn()
    .mockImplementation(
      (callback: (trx: Transaction<TestDB>) => Promise<unknown>) =>
        callback(fakeTransaction),
    );
  const setIsolationLevel = vi.fn().mockReturnValue({ execute });
  const transaction = vi.fn().mockReturnValue({ execute, setIsolationLevel });

  const fakeTransaction = {
    selectFrom: txSelectFrom,
  } as unknown as Transaction<TestDB>;

  const dataSource = {
    transaction,
    selectFrom: dsSelectFrom,
  } as unknown as Kysely<TestDB>;

  let transactionStorage: TransactionStorage<TestDB>;

  beforeAll(async () => {
    transactionStorage = await createTransactionStorage<TestDB>();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a new transaction via callback form', async () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    let observed: unknown;
    await trx(async () => {
      observed = transactionStorage.getStore();
    });
    expect(observed).toBe(fakeTransaction);
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(setIsolationLevel).not.toHaveBeenCalled();
  });

  it('sets isolation level when provided', async () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    await trx('read committed', async () => {});
    expect(setIsolationLevel).toHaveBeenCalledWith('read committed');
  });

  it('returns callback result', async () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    const result = await trx(async () => 'result');
    expect(result).toBe('result');
  });

  it('dispatches to ambient transaction inside a scope', async () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    await trx(async () => {
      trx.selectFrom('invoices');
    });
    expect(txSelectFrom).toHaveBeenCalledOnce();
    expect(dsSelectFrom).not.toHaveBeenCalled();
  });

  it('dispatches to data source outside any scope', () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    trx.selectFrom('invoices');
    expect(dsSelectFrom).toHaveBeenCalledOnce();
    expect(txSelectFrom).not.toHaveBeenCalled();
  });

  it('reuses ambient transaction when nested', async () => {
    const trx = createTransactionFactory({ dataSource, transactionStorage });
    await trx(async () => {
      await trx(async () => {
        trx.selectFrom('invoices');
      });
    });
    expect(dataSource.transaction).toHaveBeenCalledOnce();
  });
});
