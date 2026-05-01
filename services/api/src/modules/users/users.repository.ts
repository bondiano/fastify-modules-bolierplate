import type { DB } from '#db/schema.ts';
import type { AuthUser } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';
import { createTenantScopedRepository, type TenantContext } from '@kit/tenancy';

interface UsersRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

export const createUsersRepository = ({
  transaction,
  tenantContext,
}: UsersRepositoryDeps) => {
  const scoped = createTenantScopedRepository<DB, 'users'>({
    transaction,
    tenantContext,
    tableName: 'users',
  });

  /**
   * Auth flows (register, login, JWT verification) run before any tenant
   * frame is active, so they must look up users globally. The userStore
   * wrapper layered on top of the repository (`@kit/auth` adapter) uses
   * these unscoped lookups; tenant-scoped reads go through `scoped`.
   */
  const findByEmail = async (email: string): Promise<AuthUser | null> =>
    (await transaction
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst()) ?? null;

  const findByIdGlobally = async (id: string): Promise<AuthUser | null> =>
    (await transaction
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()) ?? null;

  /** Resolver-chain hook: returns the user's home tenant id if any. */
  const findDefaultTenantId = async (
    userId: string,
  ): Promise<string | null> => {
    const row = await transaction
      .selectFrom('users')
      .select('tenantId')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.tenantId ?? null;
  };

  return {
    ...scoped,
    findByEmail,
    findByIdGlobally,
    findDefaultTenantId,
  };
};

export type UsersRepository = ReturnType<typeof createUsersRepository>;
