import type { DB } from '#db/schema.ts';
import {
  createSubscriptionsRepository as factory,
  type SubscriptionsRepository as KitRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';
import type { TenantContext } from '@kit/tenancy';

interface RepoDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createSubscriptionsRepository = ({
  transaction,
  tenantContext,
}: RepoDeps): KitRepository<DB> => factory<DB>({ transaction, tenantContext });

export type SubscriptionsRepository = ReturnType<
  typeof createSubscriptionsRepository
>;
