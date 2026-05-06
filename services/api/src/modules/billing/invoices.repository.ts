import type { DB } from '#db/schema.ts';
import {
  createInvoicesRepository as factory,
  type InvoicesRepository as KitRepository,
} from '@kit/billing';
import type { Trx } from '@kit/db/transaction';
import type { TenantContext } from '@kit/tenancy';

interface RepoDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createInvoicesRepository = ({
  transaction,
  tenantContext,
}: RepoDeps): KitRepository<DB> => factory<DB>({ transaction, tenantContext });

export type InvoicesRepository = ReturnType<typeof createInvoicesRepository>;
