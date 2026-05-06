/**
 * System-level repositories for the global pricing catalog: `plans`,
 * `prices`, `features`, `plan_features`. These tables have no tenant
 * scope -- adding a feature to a plan is an ops action, not a per-tenant
 * customization. Per-tenant overrides land in a `tenant_feature_overrides`
 * table later.
 */
import type { Insertable, Selectable } from 'kysely';

import type { Trx } from '@kit/db/runtime';

import type {
  BillingDB,
  FeaturesTable,
  PlanFeaturesTable,
  PlansTable,
  PricesTable,
} from './schema.js';

export type PlanRow = Selectable<PlansTable>;
export type PriceRow = Selectable<PricesTable>;
export type FeatureRow = Selectable<FeaturesTable>;
export type PlanFeatureRow = Selectable<PlanFeaturesTable>;

export type PlanInsert = Insertable<PlansTable>;
export type PriceInsert = Insertable<PricesTable>;
export type FeatureInsert = Insertable<FeaturesTable>;
export type PlanFeatureInsert = Insertable<PlanFeaturesTable>;

export interface PlansRepository {
  findById(id: string): Promise<PlanRow | null>;
  findBySlug(slug: string): Promise<PlanRow | null>;
  findAllActive(): Promise<readonly PlanRow[]>;
}

export interface PricesRepository {
  findById(id: string): Promise<PriceRow | null>;
  findByProviderPriceId(providerPriceId: string): Promise<PriceRow | null>;
  findActiveByPlanId(planId: string): Promise<readonly PriceRow[]>;
}

export interface FeaturesRepository {
  findByKey(key: string): Promise<FeatureRow | null>;
  findAll(): Promise<readonly FeatureRow[]>;
}

export interface PlanFeaturesRepository {
  findByPlanId(planId: string): Promise<readonly PlanFeatureRow[]>;
  findByFeatureKey(featureKey: string): Promise<readonly PlanFeatureRow[]>;
  /** `(plan_id, feature_key)` is the composite PK; `null` when no row. */
  findOne(planId: string, featureKey: string): Promise<PlanFeatureRow | null>;
}

export interface RepoDeps<DB extends BillingDB> {
  readonly transaction: Trx<DB>;
}

export const createPlansRepository = <DB extends BillingDB>({
  transaction,
}: RepoDeps<DB>): PlansRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  return {
    async findById(id) {
      return (
        (await trx
          .selectFrom('plans')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) ?? null
      );
    },
    async findBySlug(slug) {
      return (
        (await trx
          .selectFrom('plans')
          .selectAll()
          .where('slug', '=', slug)
          .executeTakeFirst()) ?? null
      );
    },
    async findAllActive() {
      return await trx
        .selectFrom('plans')
        .selectAll()
        .where('is_active', '=', true)
        .orderBy('created_at', 'desc')
        .execute();
    },
  };
};

export const createPricesRepository = <DB extends BillingDB>({
  transaction,
}: RepoDeps<DB>): PricesRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  return {
    async findById(id) {
      return (
        (await trx
          .selectFrom('prices')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) ?? null
      );
    },
    async findByProviderPriceId(providerPriceId) {
      return (
        (await trx
          .selectFrom('prices')
          .selectAll()
          .where('provider_price_id', '=', providerPriceId)
          .executeTakeFirst()) ?? null
      );
    },
    async findActiveByPlanId(planId) {
      return await trx
        .selectFrom('prices')
        .selectAll()
        .where('plan_id', '=', planId)
        .where('is_active', '=', true)
        .orderBy('amount_cents', 'asc')
        .execute();
    },
  };
};

export const createFeaturesRepository = <DB extends BillingDB>({
  transaction,
}: RepoDeps<DB>): FeaturesRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  return {
    async findByKey(key) {
      return (
        (await trx
          .selectFrom('features')
          .selectAll()
          .where('key', '=', key)
          .executeTakeFirst()) ?? null
      );
    },
    async findAll() {
      return await trx
        .selectFrom('features')
        .selectAll()
        .orderBy('key', 'asc')
        .execute();
    },
  };
};

export const createPlanFeaturesRepository = <DB extends BillingDB>({
  transaction,
}: RepoDeps<DB>): PlanFeaturesRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trx = transaction as any;
  return {
    async findByPlanId(planId) {
      return await trx
        .selectFrom('plan_features')
        .selectAll()
        .where('plan_id', '=', planId)
        .execute();
    },
    async findByFeatureKey(featureKey) {
      return await trx
        .selectFrom('plan_features')
        .selectAll()
        .where('feature_key', '=', featureKey)
        .execute();
    },
    async findOne(planId, featureKey) {
      return (
        (await trx
          .selectFrom('plan_features')
          .selectAll()
          .where('plan_id', '=', planId)
          .where('feature_key', '=', featureKey)
          .executeTakeFirst()) ?? null
      );
    },
  };
};
