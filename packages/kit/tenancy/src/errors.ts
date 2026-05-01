import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@kit/errors';

/**
 * Thrown when a tenant-scoped operation runs without an active tenant frame.
 * Maps to HTTP 400 -- per PRD §2a, "missing tenant -> 400 on scoped route".
 */
export class TenantNotResolved extends BadRequestException {
  protected override getDefaultCode(): string {
    return 'TENANT_NOT_RESOLVED';
  }

  constructor(message = 'Tenant not resolved for the current scope') {
    super(message);
  }
}

interface CrossTenantAccessMetadata {
  readonly expected: string;
  readonly actual: string;
}

/**
 * Thrown when caller tries to act on a tenant other than the active one.
 * Maps to HTTP 403 -- the request is authenticated but not authorised for
 * the target tenant.
 */
export class CrossTenantAccess extends ForbiddenException {
  public override readonly metadata: CrossTenantAccessMetadata;

  protected override getDefaultCode(): string {
    return 'CROSS_TENANT_ACCESS';
  }

  constructor(expected: string, actual: string) {
    super(
      `Cross-tenant access denied: expected tenant "${expected}", got "${actual}"`,
      { metadata: { expected, actual } },
    );
    this.metadata = { expected, actual };
  }
}

/**
 * 403 -- the tenant resolver chain produced a tenant id, but the
 * authenticated user has no membership in that tenant. Closes the
 * `X-Tenant-ID` spoofing hole when paired with the `resolveMembership`
 * plugin option.
 */
export class MembershipRequired extends ForbiddenException {
  protected override getDefaultCode(): string {
    return 'MEMBERSHIP_REQUIRED';
  }

  constructor(tenantId: string) {
    super(`Authenticated user is not a member of tenant "${tenantId}"`, {
      metadata: { tenantId },
    });
  }
}

/** 404 -- no live tenant row with the given id or slug. */
export class TenantNotFound extends NotFoundException {
  protected override getDefaultCode(): string {
    return 'TENANT_NOT_FOUND';
  }

  constructor(idOrSlug: string) {
    super(`Tenant "${idOrSlug}" not found`);
  }
}

/** 409 -- an explicit slug rename collided with an existing tenant. */
export class TenantSlugConflict extends ConflictException {
  protected override getDefaultCode(): string {
    return 'TENANT_SLUG_CONFLICT';
  }

  constructor(slug: string) {
    super(`Tenant slug "${slug}" is already in use`);
  }
}

/**
 * 500 -- slug auto-derivation exhausted its numeric-suffix search space. Only
 * reachable if the base slug already has hundreds of collisions; signals a
 * pathological input rather than a user error.
 */
export class TenantSlugExhausted extends InternalServerErrorException {
  protected override getDefaultCode(): string {
    return 'TENANT_SLUG_EXHAUSTED';
  }

  constructor(base: string) {
    super(
      `Could not derive a unique slug from "${base}" within the suffix budget`,
    );
  }
}

/** 404 -- no membership row with the given id in the current tenant. */
export class MembershipNotFound extends NotFoundException {
  protected override getDefaultCode(): string {
    return 'MEMBERSHIP_NOT_FOUND';
  }

  constructor(id: string) {
    super(`Membership "${id}" not found`);
  }
}

/**
 * 409 -- caller invited an email whose user already has an active
 * membership in the current tenant. The route handler can read the
 * existing id from `metadata.membershipId` for a "show existing" UX.
 */
export class MembershipExists extends ConflictException {
  protected override getDefaultCode(): string {
    return 'MEMBERSHIP_EXISTS';
  }

  constructor(membershipId: string) {
    super(`Membership "${membershipId}" already exists in this tenant`, {
      metadata: { membershipId },
    });
  }
}

/** 404 -- token didn't match any invitation row. */
export class InvitationNotFound extends NotFoundException {
  protected override getDefaultCode(): string {
    return 'INVITATION_NOT_FOUND';
  }

  constructor(id?: string) {
    super(id ? `Invitation "${id}" not found` : 'Invitation not found');
  }
}

/**
 * 422 -- invitation is past its `expires_at`. Business-rule rejection, not a
 * malformed request.
 */
export class InvitationExpired extends UnprocessableEntityException {
  protected override getDefaultCode(): string {
    return 'INVITATION_EXPIRED';
  }

  constructor() {
    super('Invitation has expired');
  }
}

/** 409 -- invitation has already been consumed. */
export class InvitationAlreadyAccepted extends ConflictException {
  protected override getDefaultCode(): string {
    return 'INVITATION_ALREADY_ACCEPTED';
  }

  constructor() {
    super('Invitation has already been accepted');
  }
}

/**
 * 403 -- the user attempting to accept an invitation does not match the
 * email the invitation was issued to. Stops a leaked token from being
 * redeemed under a different account.
 */
export class InvitationEmailMismatch extends ForbiddenException {
  protected override getDefaultCode(): string {
    return 'INVITATION_EMAIL_MISMATCH';
  }

  constructor() {
    super('Invitation cannot be accepted: email mismatch');
  }
}
