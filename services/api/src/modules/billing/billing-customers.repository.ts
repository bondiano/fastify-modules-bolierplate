import type { DB } from '#db/schema.ts';
import {
  createBillingCustomersRepository as factory,
  type BillingCustomersRepository as KitRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';
import type { TenantContext } from '@kit/tenancy';

interface RepoDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createBillingCustomersRepository = ({
  transaction,
  tenantContext,
}: RepoDeps): KitRepository<DB> => factory<DB>({ transaction, tenantContext });

export type BillingCustomersRepository = ReturnType<
  typeof createBillingCustomersRepository
>;
