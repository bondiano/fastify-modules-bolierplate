import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { makeResourceSpec } from '../views/fixtures.js';

import { assertTenantForResource } from './_helpers.js';

const requestWith = (tenant?: { tenantId: string }): FastifyRequest =>
  ({
    ...(tenant ? { tenant } : {}),
  }) as unknown as FastifyRequest;

describe('assertTenantForResource', () => {
  it('passes through for system-scoped resources without a tenant frame', () => {
    const spec = makeResourceSpec({ tenantScoped: false, scope: 'system' });
    expect(() => assertTenantForResource(spec, requestWith())).not.toThrow();
  });

  it('passes through for tenant-scoped resources when request.tenant is set', () => {
    const spec = makeResourceSpec({ tenantScoped: true, scope: 'tenant' });
    expect(() =>
      assertTenantForResource(spec, requestWith({ tenantId: 't-1' })),
    ).not.toThrow();
  });

  it('throws BadRequest with TENANT_REQUIRED_FOR_ADMIN when no tenant frame is set', () => {
    const spec = makeResourceSpec({ tenantScoped: true, scope: 'tenant' });
    expect(() => assertTenantForResource(spec, requestWith())).toThrow(
      /requires a tenant context/,
    );
  });

  it('treats an empty tenant id as missing', () => {
    const spec = makeResourceSpec({ tenantScoped: true, scope: 'tenant' });
    expect(() =>
      assertTenantForResource(spec, requestWith({ tenantId: '' })),
    ).toThrow();
  });
});
