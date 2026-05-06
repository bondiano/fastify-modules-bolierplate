/**
 * Repository for the `billing_customers` table.
 *
 * Two surfaces:
 * - **Tenant-scoped reads** (admin pagination, dashboard widget). Composes
 *   `@kit/tenancy`'s `createTenantScopedRepository`.
 * - **System-level upsert** -- the checkout flow runs before any tenant
 *   frame is opened (the route's `request.currentTenant()` *is* set, but
 *   the worker re-fetches by tenantId). `upsert(...)` does
 *   `INSERT ... ON CONFLICT (tenant_id, provider) WHERE deleted_at IS NULL
 *   DO UPDATE SET email = EXCLUDED.email RETURNING *` so duplicate
 *   creates from retries/replays return the existing row.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type { BillingCustomersTable, BillingDB } from './schema.js';

export type BillingCustomerInsert = Insertable<BillingCustomersTable>;
export type BillingCustomerRow = Selectable<BillingCustomersTable>;

type ReadSurface<DB extends BillingDB> = Pick<
  TenantScopedRepository<DB, 'billing_customers'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

export interface BillingCustomerUpsertInput {
  readonly tenantId: string;
  readonly provider: string;
  readonly providerCustomerId: string;
  readonly email: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface BillingCustomersRepository<
  DB extends BillingDB,
> extends ReadSurface<DB> {
  /** System-level upsert. Frame-less; safe to call before `withTenant`
   * is opened. */
  upsert(input: BillingCustomerUpsertInput): Promise<BillingCustomerRow>;

  /** Tenant-aware read: returns null when the tenant has no billing
   * customer for the given provider yet. Wraps the tenant-scoped repo
   * so cross-tenant reads are impossible. */
  findByTenantAndProvider(
    tenantId: string,
    provider: string,
  ): Promise<BillingCustomerRow | null>;

  /** Webhook lookup: incoming events arrive with the provider customer
   * id only; we map back to the local row. Frame-less. */
  findByProviderCustomerId(
    provider: string,
    providerCustomerId: string,
  ): Promise<BillingCustomerRow | null>;
}

export interface BillingCustomersRepositoryDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createBillingCustomersRepository = <DB extends BillingDB>({
  transaction,
  tenantContext,
}: BillingCustomersRepositoryDeps<DB>): BillingCustomersRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'billing_customers'>({
    transaction,
    tenantContext,
    tableName: 'billing_customers',
    tenantColumn: 'tenant_id',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;

  return {
    table: scoped.table,
    findById: scoped.findById,
    findByIdOrThrow: scoped.findByIdOrThrow,
    findAll: scoped.findAll,
    findPaginated: scoped.findPaginated,
    findPaginatedByPage: scoped.findPaginatedByPage,
    count: scoped.count,

    async upsert(input) {
      const values = {
        tenant_id: input.tenantId,
        provider: input.provider,
        provider_customer_id: input.providerCustomerId,
        email: input.email,
        metadata: input.metadata ?? {},
      };
      return await trx
        .insertInto('billing_customers')
        .values(values)
        .onConflict(
          (oc: {
            columns: (cols: string[]) => {
              where: (
                col: string,
                op: string,
                value: unknown,
              ) => {
                doUpdateSet: (
                  cb: (eb: {
                    ref: (col: string) => unknown;
                  }) => Record<string, unknown>,
                ) => unknown;
              };
            };
          }) =>
            oc
              .columns(['tenant_id', 'provider'])
              .where('deleted_at', 'is', null)
              .doUpdateSet((eb) => ({
                provider_customer_id: eb.ref('excluded.provider_customer_id'),
                email: eb.ref('excluded.email'),
                metadata: eb.ref('excluded.metadata'),
                updated_at: trx.fn('now'),
              })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findByTenantAndProvider(tenantId, provider) {
      return (
        (await trx
          .selectFrom('billing_customers')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('provider', '=', provider)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()) ?? null
      );
    },

    async findByProviderCustomerId(provider, providerCustomerId) {
      return (
        (await trx
          .selectFrom('billing_customers')
          .selectAll()
          .where('provider', '=', provider)
          .where('provider_customer_id', '=', providerCustomerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()) ?? null
      );
    },
  };
};
