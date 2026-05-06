import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import type { MailerService } from '@kit/mailer';
import {
  createMembershipsService as factory,
  type MembershipsService as KitMembershipsService,
  type TenantContext,
} from '@kit/tenancy';

import type { UsersRepository } from '../users/users.repository.ts';

import type { InvitationsRepository } from './invitations.repository.ts';
import type { MembershipsRepository } from './memberships.repository.ts';
import type { TenantsRepository } from './tenants.repository.ts';

interface MembershipsServiceDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
  membershipsRepository: MembershipsRepository;
  invitationsRepository: InvitationsRepository;
  usersRepository: UsersRepository;
  tenantsRepository: TenantsRepository;
  mailerService: MailerService;
}

export const createMembershipsService = ({
  transaction,
  tenantContext,
  membershipsRepository,
  invitationsRepository,
  usersRepository,
  tenantsRepository,
  mailerService,
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
    onInvitationCreated: async (event) => {
      // Look up the tenant + inviter labels for the email body. Both
      // are best-effort: a hard delete or rename mid-flow falls back
      // to neutral copy ("a workspace" / "an administrator"), keeping
      // the message useful even if the lookup fails.
      const [tenant, inviter] = await Promise.all([
        // The tenants repo is system-level (the `tenants` table itself
        // is not tenant-scoped) so `findById` reads cross-tenant
        // without an `unscoped()` escape hatch.
        tenantsRepository.findById(event.tenantId),
        event.invitedBy
          ? usersRepository.findByIdGlobally(event.invitedBy)
          : Promise.resolve(null),
      ]);
      await mailerService.send(
        'tenant-invitation',
        {
          tenantName: tenant?.name ?? 'a workspace',
          inviter: inviter?.email ?? 'an administrator',
          role: event.role,
          acceptUrl: `${config.APP_URL}/auth/invite?token=${encodeURIComponent(event.token)}`,
          expiresAt: event.expiresAt.toUTCString(),
          productName: config.APP_NAME,
        },
        {
          idempotencyKey: `tenant-invitation:${event.invitationId}`,
          to: event.email,
          tenantId: event.tenantId,
        },
      );
    },
  });

export type MembershipsService = ReturnType<typeof createMembershipsService>;
