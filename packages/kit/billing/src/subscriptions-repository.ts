/**
 * Repository for the `subscriptions` table.
 *
 * Mirrors the dual-surface pattern from `mail-deliveries-repository`:
 * - tenant-scoped reads for admin pagination + dashboard widget;
 * - system-level `upsertFromEvent` so the `billing.process-event` worker
 *   can persist webhook updates inside `tenantContext.withTenant(...)`
 *   AS WELL AS frame-less calls from reconciliation jobs.
 *
 * The provider's subscription id (`sub_...`) is the natural key; we
 * `INSERT ... ON CONFLICT (provider_subscription_id) DO UPDATE` so
 * webhook retries and reconciliation diff events both converge to the
 * latest provider state.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';
import {
  createTenantScopedRepository,
  type TenantContext,
  type TenantScopedRepository,
} from '@kit/tenancy';

import type { NormalizedSubscription } from './events.js';
import type { BillingDB, SubscriptionsTable } from './schema.js';

export type SubscriptionInsert = Insertable<SubscriptionsTable>;
export type SubscriptionRow = Selectable<SubscriptionsTable>;

type ReadSurface<DB extends BillingDB> = Pick<
  TenantScopedRepository<DB, 'subscriptions'>,
  | 'table'
  | 'findById'
  | 'findByIdOrThrow'
  | 'findAll'
  | 'findPaginated'
  | 'findPaginatedByPage'
  | 'count'
>;

export interface SubscriptionUpsertFromEventInput {
  readonly tenantId: string;
  readonly billingCustomerId: string;
  readonly planId: string | null;
  readonly subscription: NormalizedSubscription;
}

export interface SubscriptionsRepository<
  DB extends BillingDB,
> extends ReadSurface<DB> {
  upsertFromEvent(
    input: SubscriptionUpsertFromEventInput,
  ): Promise<SubscriptionRow>;

  findByProviderSubscriptionId(
    providerSubscriptionId: string,
  ): Promise<SubscriptionRow | null>;

  findActiveByTenant(tenantId: string): Promise<SubscriptionRow | null>;

  /** Used by `billing.reconcile-subscriptions`: stream every active /
   * trialing / past_due row across all tenants. Frame-less. */
  findAllForReconciliation(
    limit: number,
    cursor?: string,
  ): Promise<readonly SubscriptionRow[]>;
}

export interface SubscriptionsRepositoryDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
  readonly tenantContext: TenantContext;
}

export const createSubscriptionsRepository = <DB extends BillingDB>({
  transaction,
  tenantContext,
}: SubscriptionsRepositoryDeps<DB>): SubscriptionsRepository<DB> => {
  const scoped = createTenantScopedRepository<DB, 'subscriptions'>({
    transaction,
    tenantContext,
    tableName: 'subscriptions',
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

    async upsertFromEvent({
      tenantId,
      billingCustomerId,
      planId,
      subscription,
    }) {
      const values = {
        tenant_id: tenantId,
        billing_customer_id: billingCustomerId,
        plan_id: planId,
        provider_subscription_id: subscription.providerSubscriptionId,
        status: subscription.status,
        current_period_start: subscription.currentPeriodStart.toISOString(),
        current_period_end: subscription.currentPeriodEnd.toISOString(),
        cancel_at: subscription.cancelAt?.toISOString() ?? null,
        canceled_at: subscription.canceledAt?.toISOString() ?? null,
        trial_end: subscription.trialEnd?.toISOString() ?? null,
        metadata: subscription.metadata,
      };
      return await trx
        .insertInto('subscriptions')
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
            oc.column('provider_subscription_id').doUpdateSet((eb) => ({
              status: eb.ref('excluded.status'),
              plan_id: eb.ref('excluded.plan_id'),
              current_period_start: eb.ref('excluded.current_period_start'),
              current_period_end: eb.ref('excluded.current_period_end'),
              cancel_at: eb.ref('excluded.cancel_at'),
              canceled_at: eb.ref('excluded.canceled_at'),
              trial_end: eb.ref('excluded.trial_end'),
              metadata: eb.ref('excluded.metadata'),
              updated_at: trx.fn('now'),
            })),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findByProviderSubscriptionId(providerSubscriptionId) {
      return (
        (await trx
          .selectFrom('subscriptions')
          .selectAll()
          .where('provider_subscription_id', '=', providerSubscriptionId)
          .executeTakeFirst()) ?? null
      );
    },

    async findActiveByTenant(tenantId) {
      return (
        (await trx
          .selectFrom('subscriptions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('status', 'in', ['active', 'trialing', 'past_due'])
          .orderBy('current_period_end', 'desc')
          .limit(1)
          .executeTakeFirst()) ?? null
      );
    },

    async findAllForReconciliation(limit, cursor) {
      let query = trx
        .selectFrom('subscriptions')
        .selectAll()
        .where('status', 'in', ['active', 'trialing', 'past_due'])
        .orderBy('id', 'asc')
        .limit(limit);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }
      return await query.execute();
    },
  };
};
