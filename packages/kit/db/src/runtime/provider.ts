import { asFunction, Lifetime } from 'awilix';

import type { ContainerProvider } from '@kit/core/di';

import { createTransactionFactory } from './transaction.js';

/**
 * Registers the `transaction` proxy into the DI container.
 * Requires `dataSource` and `transactionStorage` to already be in the cradle
 * (typically via `extraValues`).
 */
// eslint-disable-next-line unicorn/consistent-function-scoping
export const dbProvider = (): ContainerProvider => (container) => {
  container.register({
    transaction: asFunction(createTransactionFactory, {
      lifetime: Lifetime.SINGLETON,
    }),
  });
};
