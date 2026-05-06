/**
 * Kysely-backed implementation of `UserIdentitiesStore` from `@kit/auth`.
 * Frame-less by design -- OAuth callbacks run before any tenant frame
 * exists (the user might not have a tenant yet). The auth service opens
 * a tenant frame later through `registrationStore.create(...)` when a
 * brand-new user is being provisioned.
 */
import type { Insertable, Selectable } from 'kysely';

import type { DB, UserIdentitiesTable } from '#db/schema.ts';
import type { UserIdentitiesStore, UserIdentityRow } from '@kit/auth';
import type { Trx } from '@kit/db/transaction';

interface RepoDeps {
  transaction: Trx<DB>;
}

const toRow = (row: Selectable<UserIdentitiesTable>): UserIdentityRow => ({
  id: row.id,
  userId: row.userId,
  provider: row.provider,
  providerUserId: row.providerUserId,
  email: row.email,
  emailVerified: row.emailVerified,
  rawProfile: row.rawProfile,
  createdAt: row.createdAt,
});

export const createUserIdentitiesRepository = ({
  transaction,
}: RepoDeps): UserIdentitiesStore => {
  return {
    async findByProviderUserId(provider, providerUserId) {
      const row = await transaction
        .selectFrom('user_identities')
        .selectAll()
        .where('provider', '=', provider as UserIdentitiesTable['provider'])
        .where('providerUserId', '=', providerUserId)
        .executeTakeFirst();
      return row ? toRow(row) : null;
    },

    async findByUserId(userId) {
      const rows = await transaction
        .selectFrom('user_identities')
        .selectAll()
        .where('userId', '=', userId)
        .orderBy('createdAt', 'asc')
        .execute();
      return rows.map((row) => toRow(row));
    },

    async create(input) {
      const values: Insertable<UserIdentitiesTable> = {
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
        emailVerified: input.emailVerified,
        rawProfile: input.rawProfile,
      };
      const inserted = await transaction
        .insertInto('user_identities')
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRow(inserted);
    },

    async delete(id) {
      await transaction
        .deleteFrom('user_identities')
        .where('id', '=', id)
        .execute();
    },

    async countForUser(userId) {
      const result = await transaction
        .selectFrom('user_identities')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('userId', '=', userId)
        .executeTakeFirstOrThrow();
      return Number(result.count);
    },
  };
};

export type UserIdentitiesRepository = ReturnType<
  typeof createUserIdentitiesRepository
>;
