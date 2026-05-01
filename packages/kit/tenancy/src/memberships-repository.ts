import type { Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';

import type { TenantContext } from './context.js';
import {
  createTenantScopedSoftDeleteRepository,
  type TenantScopedSoftDeleteRepository,
} from './repository.js';
import type { TenancyDB } from './schema.js';

/**
 * Tenant-scoped CRUD for `memberships`, plus user-keyed lookups that
 * intentionally bypass the tenant frame (e.g. for `fromUserDefault` which
 * resolves the tenant before any frame is active).
 *
 * Soft-delete is enabled: `revoke()` in the service layer flips
 * `deletedAt` instead of physically deleting, preserving audit history.
 * All cross-tenant reads filter out soft-deleted rows so a revoked
 * membership cannot resurface (e.g. through `fromUserDefault`).
 */
export interface MembershipsRepository<
  DB extends TenancyDB,
> extends TenantScopedSoftDeleteRepository<DB, 'memberships'> {
  /** Tenant-scoped: find the active membership for `userId` in the current tenant. */
  findByUserIdInCurrentTenant(
    userId: string,
  ): Promise<Selectable<DB['memberships']> | undefined>;
  /**
   * Tenant-scoped: stamp `joinedAt = now()` when an invited user accepts.
   * Returns `undefined` if `userId` is not an active member of the current tenant.
   */
  markJoinedByUserId(
    userId: string,
  ): Promise<Selectable<DB['memberships']> | undefined>;
  /**
   * Cross-tenant: every active membership row for `userId`, ordered by
   * `joinedAt` asc. Soft-deleted memberships are filtered out.
   */
  findAllForUser(userId: string): Promise<Selectable<DB['memberships']>[]>;
  /**
   * Cross-tenant: the user's default membership. Picks the oldest accepted
   * row (`joinedAt IS NOT NULL`). Returns `undefined` if the user is not a
   * member of any tenant yet -- callers must treat this as "no default" and
   * fall through the resolver chain.
   */
  findDefaultForUser(
    userId: string,
  ): Promise<Selectable<DB['memberships']> | undefined>;
  /**
   * Cross-tenant: lookup a user's active membership in a specific tenant
   * **without** opening a tenant frame. Powers the `resolveMembership`
   * plugin option, which runs before the frame is opened.
   */
  findByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<Selectable<DB['memberships']> | undefined>;
}

export interface MembershipsRepositoryDeps<DB extends TenancyDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createMembershipsRepository = <DB extends TenancyDB>({
  transaction,
  tenantContext,
}: MembershipsRepositoryDeps<DB>): MembershipsRepository<DB> => {
  const scoped = createTenantScopedSoftDeleteRepository<DB, 'memberships'>({
    transaction,
    tenantContext,
    tableName: 'memberships',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const currentTenantId = (): string => tenantContext.currentTenant().tenantId;

  return {
    ...scoped,

    findByUserIdInCurrentTenant: async (userId) =>
      await trx
        .selectFrom('memberships')
        .selectAll()
        .where(trx.dynamic.ref('tenantId'), '=', currentTenantId())
        .where(trx.dynamic.ref('userId'), '=', userId)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .executeTakeFirst(),

    markJoinedByUserId: async (userId) =>
      await trx
        .updateTable('memberships')
        .set({ joinedAt: new Date().toISOString() })
        .where(trx.dynamic.ref('tenantId'), '=', currentTenantId())
        .where(trx.dynamic.ref('userId'), '=', userId)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .returningAll()
        .executeTakeFirst(),

    findAllForUser: async (userId) =>
      await trx
        .selectFrom('memberships')
        .selectAll()
        .where(trx.dynamic.ref('userId'), '=', userId)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .orderBy(trx.dynamic.ref('joinedAt'), 'asc')
        .execute(),

    findDefaultForUser: async (userId) =>
      await trx
        .selectFrom('memberships')
        .selectAll()
        .where(trx.dynamic.ref('userId'), '=', userId)
        .where(trx.dynamic.ref('joinedAt'), 'is not', null)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .orderBy(trx.dynamic.ref('joinedAt'), 'asc')
        .limit(1)
        .executeTakeFirst(),

    findByUserAndTenant: async (userId, tenantId) =>
      await trx
        .selectFrom('memberships')
        .selectAll()
        .where(trx.dynamic.ref('userId'), '=', userId)
        .where(trx.dynamic.ref('tenantId'), '=', tenantId)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .executeTakeFirst(),
  };
};
