import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createMailDeliveriesRepository as factory,
  type MailDeliveriesRepository as KitMailDeliveriesRepository,
} from '@kit/mailer';
import type { TenantContext } from '@kit/tenancy';

interface MailDeliveriesRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createMailDeliveriesRepository = ({
  transaction,
  tenantContext,
}: MailDeliveriesRepositoryDeps): KitMailDeliveriesRepository<DB> =>
  factory<DB>({ transaction, tenantContext });

export type MailDeliveriesRepository = ReturnType<
  typeof createMailDeliveriesRepository
>;
