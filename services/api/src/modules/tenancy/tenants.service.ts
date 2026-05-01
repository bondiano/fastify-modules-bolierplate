import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createTenantsService as factory,
  type TenantsService as KitTenantsService,
} from '@kit/tenancy';

import type { TenantsRepository } from './tenants.repository.ts';

interface TenantsServiceDeps {
  tenantsRepository: TenantsRepository;
  transaction: Trx<DB>;
}

export const createTenantsService = ({
  tenantsRepository,
  transaction,
}: TenantsServiceDeps): KitTenantsService =>
  factory<DB>({ tenantsRepository, transaction });

export type TenantsService = ReturnType<typeof createTenantsService>;
