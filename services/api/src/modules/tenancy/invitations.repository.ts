import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createInvitationsRepository as factory,
  type InvitationsRepository as KitInvitationsRepository,
  type TenantContext,
} from '@kit/tenancy';

interface InvitationsRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createInvitationsRepository = ({
  transaction,
  tenantContext,
}: InvitationsRepositoryDeps): KitInvitationsRepository<DB> =>
  factory<DB>({ transaction, tenantContext });

export type InvitationsRepository = ReturnType<
  typeof createInvitationsRepository
>;
