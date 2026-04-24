import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTenantContext,
  createTenantStorage,
  type TenantContext,
  type TenantStorage,
} from './context.js';
import { CrossTenantAccess, TenantNotResolved } from './errors.js';

describe('tenant context', () => {
  let storage: TenantStorage;
  let context: TenantContext;

  beforeEach(async () => {
    storage = await createTenantStorage();
    context = createTenantContext({ tenantStorage: storage });
  });

  it('exposes the active tenant inside withTenant', async () => {
    let observed: string | undefined;
    await context.withTenant('acme', async () => {
      observed = context.currentTenant().tenantId;
    });
    expect(observed).toBe('acme');
  });

  it('returns the callback result', async () => {
    const result = await context.withTenant('acme', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors thrown inside the scope', async () => {
    await expect(
      context.withTenant('acme', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('replaces the frame for nested scopes and restores it on exit', async () => {
    const observed: string[] = [];
    await context.withTenant('outer', async () => {
      observed.push(context.currentTenant().tenantId);
      await context.withTenant('inner', async () => {
        observed.push(context.currentTenant().tenantId);
      });
      observed.push(context.currentTenant().tenantId);
    });
    expect(observed).toEqual(['outer', 'inner', 'outer']);
  });

  describe('outside any scope', () => {
    it('currentTenant throws TenantNotResolved (400, code)', () => {
      let caught: unknown;
      try {
        context.currentTenant();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TenantNotResolved);
      expect((caught as TenantNotResolved).statusCode).toBe(400);
      expect((caught as TenantNotResolved).code).toBe('TENANT_NOT_RESOLVED');
    });

    it('tryCurrentTenant returns null', () => {
      expect(context.tryCurrentTenant()).toBeNull();
    });

    it('assertTenant throws TenantNotResolved', () => {
      expect(() => context.assertTenant('acme')).toThrow(TenantNotResolved);
    });
  });

  describe('assertTenant inside a scope', () => {
    it('returns the active value when the id matches', async () => {
      await context.withTenant('acme', async () => {
        expect(context.assertTenant('acme').tenantId).toBe('acme');
      });
    });

    it('throws CrossTenantAccess with expected/actual metadata on mismatch', async () => {
      let caught: unknown;
      await context.withTenant('acme', async () => {
        try {
          context.assertTenant('globex');
        } catch (error) {
          caught = error;
        }
      });
      expect(caught).toBeInstanceOf(CrossTenantAccess);
      const error = caught as CrossTenantAccess;
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('CROSS_TENANT_ACCESS');
      expect(error.metadata).toEqual({ expected: 'globex', actual: 'acme' });
    });
  });
});
