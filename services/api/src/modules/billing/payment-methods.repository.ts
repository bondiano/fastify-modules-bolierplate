import type { DB } from '#db/schema.ts';
import {
  createPaymentMethodsRepository as factory,
  type PaymentMethodsRepository as KitRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';
import type { TenantContext } from '@kit/tenancy';

interface RepoDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createPaymentMethodsRepository = ({
  transaction,
  tenantContext,
}: RepoDeps): KitRepository<DB> => factory<DB>({ transaction, tenantContext });

export type PaymentMethodsRepository = ReturnType<
  typeof createPaymentMethodsRepository
>;
