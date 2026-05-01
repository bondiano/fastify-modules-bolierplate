import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createTenantsRepository as factory,
  type TenantsRepository as KitTenantsRepository,
} from '@kit/tenancy';

interface TenantsRepositoryDeps {
  transaction: Trx<DB>;
}

export const createTenantsRepository = ({
  transaction,
}: TenantsRepositoryDeps): KitTenantsRepository<DB> =>
  factory<DB>({ transaction });

export type TenantsRepository = ReturnType<typeof createTenantsRepository>;
