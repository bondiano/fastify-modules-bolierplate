import type { DB } from '#db/schema.ts';
import {
  createFeaturesRepository as featuresFactory,
  createPlanFeaturesRepository as planFeaturesFactory,
  createPlansRepository as plansFactory,
  createPricesRepository as pricesFactory,
  type FeaturesRepository as KitFeaturesRepository,
  type PlanFeaturesRepository as KitPlanFeaturesRepository,
  type PlansRepository as KitPlansRepository,
  type PricesRepository as KitPricesRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';

interface RepoDeps {
  transaction: Trx<DB>;
}

export const createPlansRepository = ({
  transaction,
}: RepoDeps): KitPlansRepository => plansFactory<DB>({ transaction });

export const createPricesRepository = ({
  transaction,
}: RepoDeps): KitPricesRepository => pricesFactory<DB>({ transaction });

export const createFeaturesRepository = ({
  transaction,
}: RepoDeps): KitFeaturesRepository => featuresFactory<DB>({ transaction });

export const createPlanFeaturesRepository = ({
  transaction,
}: RepoDeps): KitPlanFeaturesRepository =>
  planFeaturesFactory<DB>({ transaction });

export type PlansRepository = ReturnType<typeof createPlansRepository>;
export type PricesRepository = ReturnType<typeof createPricesRepository>;
export type FeaturesRepository = ReturnType<typeof createFeaturesRepository>;
export type PlanFeaturesRepository = ReturnType<
  typeof createPlanFeaturesRepository
>;
