import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createMembershipsService as factory,
  type MembershipsService as KitMembershipsService,
  type TenantContext,
} from '@kit/tenancy';

import type { UsersRepository } from '../users/users.repository.ts';

import type { InvitationsRepository } from './invitations.repository.ts';
import type { MembershipsRepository } from './memberships.repository.ts';

interface MembershipsServiceDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
  membershipsRepository: MembershipsRepository;
  invitationsRepository: InvitationsRepository;
  usersRepository: UsersRepository;
}

export const createMembershipsService = ({
  transaction,
  tenantContext,
  membershipsRepository,
  invitationsRepository,
  usersRepository,
}: MembershipsServiceDeps): KitMembershipsService =>
  factory({
    transaction,
    tenantContext,
    membershipsRepository,
    invitationsRepository,
    resolveUserEmail: async (userId) => {
      const user = await usersRepository.findByIdGlobally(userId);
      return user?.email ?? null;
    },
    resolveUserIdByEmail: async (email) => {
      const user = await usersRepository.findByEmail(email);
      return user?.id ?? null;
    },
  });

export type MembershipsService = ReturnType<typeof createMembershipsService>;
