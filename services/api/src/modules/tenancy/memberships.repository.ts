import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createMembershipsRepository as factory,
  type MembershipsRepository as KitMembershipsRepository,
  type TenantContext,
} from '@kit/tenancy';

interface MembershipsRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createMembershipsRepository = ({
  transaction,
  tenantContext,
}: MembershipsRepositoryDeps): KitMembershipsRepository<DB> =>
  factory<DB>({ transaction, tenantContext });

export type MembershipsRepository = ReturnType<
  typeof createMembershipsRepository
>;
