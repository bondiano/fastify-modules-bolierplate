import { BadRequestException, ForbiddenException } from '@kit/errors';

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
