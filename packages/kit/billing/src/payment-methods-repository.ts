/**
 * Repository for the `payment_methods` table. Tenant-scoped reads +
 * system-level apply-event writes. Mirrors `subscriptions-repository.ts`.
 *
 * `brand` and `last4` are PII-adjacent: when changes are diffed into
 * `audit_log`, the consumer-side admin override declares
 * `sensitiveColumns: ['brand', 'last4']` so they're scrubbed.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type { NormalizedPaymentMethod } from './events.js';
import type { BillingDB, PaymentMethodsTable } from './schema.js';

export type PaymentMethodInsert = Insertable<PaymentMethodsTable>;
export type PaymentMethodRow = Selectable<PaymentMethodsTable>;

type ReadSurface<DB extends BillingDB> = Pick<
  TenantScopedRepository<DB, 'payment_methods'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

export interface PaymentMethodUpsertFromEventInput {
  readonly tenantId: string;
  readonly billingCustomerId: string;
  readonly paymentMethod: NormalizedPaymentMethod;
}

export interface PaymentMethodsRepository<
  DB extends BillingDB,
> extends ReadSurface<DB> {
  upsertFromEvent(
    input: PaymentMethodUpsertFromEventInput,
  ): Promise<PaymentMethodRow>;

  /** Soft-delete: webhook `payment_method.detached` flips
   * `deleted_at`; the row stays for audit/forensic purposes. */
  markDetached(providerPaymentMethodId: string): Promise<void>;

  findByProviderPaymentMethodId(
    providerPaymentMethodId: string,
  ): Promise<PaymentMethodRow | null>;
}

export interface PaymentMethodsRepositoryDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createPaymentMethodsRepository = <DB extends BillingDB>({
  transaction,
  tenantContext,
}: PaymentMethodsRepositoryDeps<DB>): PaymentMethodsRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'payment_methods'>({
    transaction,
    tenantContext,
    tableName: 'payment_methods',
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

    async upsertFromEvent({ tenantId, billingCustomerId, paymentMethod }) {
      const values = {
        tenant_id: tenantId,
        billing_customer_id: billingCustomerId,
        provider_payment_method_id: paymentMethod.providerPaymentMethodId,
        type: paymentMethod.type,
        brand: paymentMethod.brand,
        last4: paymentMethod.last4,
        exp_month: paymentMethod.expMonth,
        exp_year: paymentMethod.expYear,
        is_default: paymentMethod.isDefault,
      };
      return await trx
        .insertInto('payment_methods')
        .values(values)
        .onConflict(
          (oc: {
            column: (col: string) => {
              doUpdateSet: (
                cb: (eb: {
                  ref: (col: string) => unknown;
                }) => Record<string, unknown>,
              ) => unknown;
            };
          }) =>
            oc.column('provider_payment_method_id').doUpdateSet((eb) => ({
              brand: eb.ref('excluded.brand'),
              last4: eb.ref('excluded.last4'),
              exp_month: eb.ref('excluded.exp_month'),
              exp_year: eb.ref('excluded.exp_year'),
              is_default: eb.ref('excluded.is_default'),
              deleted_at: null,
            })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async markDetached(providerPaymentMethodId) {
      await trx
        .updateTable('payment_methods')
        .set({ deleted_at: new Date().toISOString() })
        .where('provider_payment_method_id', '=', providerPaymentMethodId)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async findByProviderPaymentMethodId(providerPaymentMethodId) {
      return (
        (await trx
          .selectFrom('payment_methods')
          .selectAll()
          .where('provider_payment_method_id', '=', providerPaymentMethodId)
          .executeTakeFirst()) ?? null
      );
    },
  };
};
