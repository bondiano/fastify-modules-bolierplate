import type { AsyncLocalStorage } from 'node:async_hooks';

import { CrossTenantAccess, TenantNotResolved } from './errors.js';

/**
 * Value stored in the tenant AsyncLocalStorage frame. Kept minimal on
 * purpose -- the resolver chain (P2.tenancy.4) decides what additional fields
 * to populate (slug, membership, ...) without breaking this contract.
 */
export interface TenantContextValue {
  readonly tenantId: string;
}

export type TenantStorage = AsyncLocalStorage<TenantContextValue>;

export interface CreateTenantContextOptions {
  readonly tenantStorage: TenantStorage;
}

export interface TenantContext {
  /**
   * Run `fn` inside a tenant frame. Nested calls replace the outer frame
   * for the inner scope -- after `fn` returns, the outer frame is restored.
   * Use this from background jobs, CLI commands, and tests where the
   * resolver chain has not run.
   */
  withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  /** Returns the active tenant or throws `TenantNotResolved`. */
  currentTenant(): TenantContextValue;
  /** Returns the active tenant or `null` -- use for opt-in instrumentation. */
  tryCurrentTenant(): TenantContextValue | null;
  /**
   * Throws `TenantNotResolved` when no frame is active, `CrossTenantAccess`
   * when the active tenant differs from `expected`. Returns the active
   * value on success so callers can chain.
   */
  assertTenant(expected: string): TenantContextValue;
}

export const createTenantContext = ({
  tenantStorage,
}: CreateTenantContextOptions): TenantContext => {
  const tryCurrentTenant = (): TenantContextValue | null =>
    tenantStorage.getStore() ?? null;

  const currentTenant = (): TenantContextValue => {
    const value = tryCurrentTenant();
    if (!value) throw new TenantNotResolved();
    return value;
  };

  const assertTenant = (expected: string): TenantContextValue => {
    const value = currentTenant();
    if (value.tenantId !== expected) {
      throw new CrossTenantAccess(expected, value.tenantId);
    }
    return value;
  };

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId }, fn);

  return { withTenant, currentTenant, tryCurrentTenant, assertTenant };
};

/**
 * The only place where `node:async_hooks` is imported. Multiple
 * `AsyncLocalStorage` instances silently break propagation under vitest's
 * module isolation -- mirrors the guarantee in `@kit/db`'s
 * `createTransactionStorage`.
 */
export const createTenantStorage = async (): Promise<TenantStorage> => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return new AsyncLocalStorage<TenantContextValue>();
};
