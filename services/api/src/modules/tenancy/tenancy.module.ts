import type { InvitationsRepository } from './invitations.repository.ts';
import type { MembershipsRepository } from './memberships.repository.ts';
import type { MembershipsService } from './memberships.service.ts';
import type { TenantsRepository } from './tenants.repository.ts';
import type { TenantsService } from './tenants.service.ts';

declare global {
  interface Dependencies {
    tenantsRepository: TenantsRepository;
    membershipsRepository: MembershipsRepository;
    invitationsRepository: InvitationsRepository;
    tenantsService: TenantsService;
    membershipsService: MembershipsService;
  }
}
