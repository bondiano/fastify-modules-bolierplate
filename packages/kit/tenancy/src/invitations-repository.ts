import type { Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';

import type { TenantContext } from './context.js';
import {
  createTenantScopedSoftDeleteRepository,
  type TenantScopedSoftDeleteRepository,
} from './repository.js';
import type { TenancyDB } from './schema.js';

/**
 * Tenant-scoped CRUD for `invitations`, plus cross-tenant lookups for the
 * acceptance flow (the accepting user has a token but no tenant frame until
 * the service opens one for `invitation.tenantId`). Soft-delete is enabled
 * so cascading from `tenants.softDelete` leaves an audit trail.
 */
export interface InvitationsRepository<
  DB extends TenancyDB,
> extends TenantScopedSoftDeleteRepository<DB, 'invitations'> {
  /**
   * Cross-tenant: lookup a live (not soft-deleted) invitation by its
   * token hash. Used by `accept()` before any tenant frame exists.
   */
  findByTokenHash(
    tokenHash: string,
  ): Promise<Selectable<DB['invitations']> | undefined>;
  /**
   * Tenant-scoped: find a pending (not accepted, not expired, not
   * soft-deleted) invitation for `email` in the current tenant.
   */
  findPendingByEmail(
    email: string,
  ): Promise<Selectable<DB['invitations']> | undefined>;
  /**
   * Tenant-scoped: atomically stamp `acceptedAt = now()`. Filtered on
   * `acceptedAt IS NULL AND expires_at > now() AND deletedAt IS NULL` so
   * the UPDATE is the gate -- if it returns `undefined`, the invitation is
   * already consumed, expired, or revoked, and the caller must error.
   */
  markAccepted(id: string): Promise<Selectable<DB['invitations']> | undefined>;
}

export interface InvitationsRepositoryDeps<DB extends TenancyDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createInvitationsRepository = <DB extends TenancyDB>({
  transaction,
  tenantContext,
}: InvitationsRepositoryDeps<DB>): InvitationsRepository<DB> => {
  const scoped = createTenantScopedSoftDeleteRepository<DB, 'invitations'>({
    transaction,
    tenantContext,
    tableName: 'invitations',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  const currentTenantId = (): string => tenantContext.currentTenant().tenantId;

  return {
    ...scoped,

    findByTokenHash: async (tokenHash) =>
      await trx
        .selectFrom('invitations')
        .selectAll()
        .where(trx.dynamic.ref('tokenHash'), '=', tokenHash)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .executeTakeFirst(),

    findPendingByEmail: async (email) =>
      await trx
        .selectFrom('invitations')
        .selectAll()
        .where(trx.dynamic.ref('tenantId'), '=', currentTenantId())
        .where(trx.dynamic.ref('email'), '=', email)
        .where(trx.dynamic.ref('acceptedAt'), 'is', null)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .where(trx.dynamic.ref('expiresAt'), '>', new Date().toISOString())
        .executeTakeFirst(),

    markAccepted: async (id) =>
      await trx
        .updateTable('invitations')
        .set({ acceptedAt: new Date().toISOString() })
        .where(trx.dynamic.ref('tenantId'), '=', currentTenantId())
        .where(trx.dynamic.ref('id'), '=', id)
        .where(trx.dynamic.ref('acceptedAt'), 'is', null)
        .where(trx.dynamic.ref('deletedAt'), 'is', null)
        .where(trx.dynamic.ref('expiresAt'), '>', new Date().toISOString())
        .returningAll()
        .executeTakeFirst(),
  };
};
