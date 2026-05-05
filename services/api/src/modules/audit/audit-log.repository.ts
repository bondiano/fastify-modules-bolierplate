import type { DB } from '#db/schema.ts';
import {
  createAuditLogRepository as factory,
  type AuditLogRepository as KitAuditLogRepository,
} from '@kit/audit';
import type { Trx } from '@kit/db/transaction';
import type { TenantContext } from '@kit/tenancy';

interface AuditLogRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createAuditLogRepository = ({
  transaction,
  tenantContext,
}: AuditLogRepositoryDeps): KitAuditLogRepository<DB> =>
  factory<DB>({ transaction, tenantContext });

export type AuditLogRepository = ReturnType<typeof createAuditLogRepository>;
