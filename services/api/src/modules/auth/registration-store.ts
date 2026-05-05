import type { DB } from '#db/schema.ts';
import type { TenantsService } from '#modules/tenancy/tenants.service.ts';
import type { UsersRepository } from '#modules/users/users.repository.ts';
import type { CreateUserInput, UserStore } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';

interface RegistrationStoreDeps {
  transaction: Trx<DB>;
  usersRepository: UsersRepository;
  tenantsService: TenantsService;
}

/**
 * `UserStore` adapter for the `@kit/auth` plugin. Reads run unscoped
 * because auth flows (register / login / JWT verify) execute before any
 * tenant frame is active. Writes orchestrate the multi-tenant signup:
 * each new user gets a personal workspace + an `owner` membership in
 * the same transaction so the new account always has somewhere to
 * resolve into.
 */
export const createRegistrationStore = ({
  transaction,
  usersRepository,
  tenantsService,
}: RegistrationStoreDeps): UserStore => ({
  findByEmail: usersRepository.findByEmail,
  findById: usersRepository.findByIdGlobally,
  create: async (input: CreateUserInput) =>
    transaction(async () => {
      const tenant = await tenantsService.create({ name: input.email });
      const user = await transaction
        .insertInto('users')
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role ?? 'user',
          tenantId: tenant.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('memberships')
        .values({
          tenantId: tenant.id,
          userId: user.id,
          role: 'owner',
          joinedAt: new Date().toISOString(),
        })
        .execute();
      return {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      };
    }),
  updatePasswordHash: usersRepository.updatePasswordHash,
  markEmailVerified: usersRepository.markEmailVerified,
});
