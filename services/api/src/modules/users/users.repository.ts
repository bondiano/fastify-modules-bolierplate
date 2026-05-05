import type { DB } from '#db/schema.ts';
import type { AuthUser } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';
import { createTenantScopedRepository, type TenantContext } from '@kit/tenancy';

interface UsersRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
}

interface UserRowShape {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  emailVerifiedAt: Date | null;
}

const toAuthUser = (row: UserRowShape): AuthUser => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  role: row.role,
  emailVerifiedAt: row.emailVerifiedAt,
});

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
  const findByEmail = async (email: string): Promise<AuthUser | null> => {
    const row = await transaction
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    return row ? toAuthUser(row) : null;
  };

  const findByIdGlobally = async (id: string): Promise<AuthUser | null> => {
    const row = await transaction
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toAuthUser(row) : null;
  };

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

  /** Replace a user's `passwordHash`. Unscoped because auth flows run
   * outside any tenant frame. Bumps `updatedAt` so audit-style
   * timestamps stay consistent. */
  const updatePasswordHash = async (
    userId: string,
    passwordHash: string,
  ): Promise<void> => {
    await transaction
      .updateTable('users')
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where('id', '=', userId)
      .execute();
  };

  /** Stamp `emailVerifiedAt = now()`. Idempotent: a no-op when already
   * set keeps the original timestamp. */
  const markEmailVerified = async (userId: string): Promise<void> => {
    await transaction
      .updateTable('users')
      .set({ emailVerifiedAt: new Date().toISOString() })
      .where('id', '=', userId)
      .where('emailVerifiedAt', 'is', null)
      .execute();
  };

  return {
    ...scoped,
    findByEmail,
    findByIdGlobally,
    findDefaultTenantId,
    updatePasswordHash,
    markEmailVerified,
  };
};

export type UsersRepository = ReturnType<typeof createUsersRepository>;
