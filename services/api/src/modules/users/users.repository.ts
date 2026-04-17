import type { DB } from '#db/schema.ts';
import type { AuthUser, CreateUserInput, UserStore } from '@kit/auth';
import { createBaseRepository } from '@kit/db/repository';
import type { Trx } from '@kit/db/transaction';

interface UsersRepositoryDeps {
  transaction: Trx<DB>;
}

export const createUsersRepository = ({ transaction }: UsersRepositoryDeps) => {
  const base = createBaseRepository<DB, 'users'>(transaction, 'users');

  return {
    ...base,

    findByEmail: async (email: string): Promise<AuthUser | null> =>
      (await transaction
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst()) ?? null,

    /** Satisfies @kit/auth UserStore interface. */
    asUserStore: (): UserStore => ({
      findByEmail: async (email: string): Promise<AuthUser | null> => {
        const user = await transaction
          .selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst();
        return user ?? null;
      },

      findById: async (id: string): Promise<AuthUser | null> => {
        const user = await base.findById(id);
        return user ?? null;
      },

      create: async (input: CreateUserInput): Promise<AuthUser> =>
        await base.create({
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role ?? 'user',
        }),
    }),
  };
};

export type UsersRepository = ReturnType<typeof createUsersRepository>;
