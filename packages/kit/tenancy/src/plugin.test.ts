import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTenantContext, createTenantStorage } from './context.js';
import {
  createTenancyPlugin,
  withTenantBypass,
  type ResolveMembershipFn,
  type TenancyPluginOptions,
} from './plugin.js';
import { fromHeader, fromSubdomain, type TenantResolver } from './resolvers.js';

const explodingResolver: TenantResolver = () => {
  throw new Error('resolver kaput');
};

interface BuildOptions {
  resolverOrder: readonly TenantResolver[];
  registerRoutes?: (fastify: FastifyInstance) => void | Promise<void>;
  resolveMembership?: ResolveMembershipFn;
  getUserId?: TenancyPluginOptions['getUserId'];
}

const buildFastify = async ({
  resolverOrder,
  registerRoutes,
  resolveMembership,
  getUserId,
}: BuildOptions) => {
  const fastify = Fastify({ logger: false });
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });

  fastify.decorate('diContainer', {
    cradle: { tenantStorage, tenantContext },
  });

  fastify.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    reply
      .status(error.statusCode ?? 500)
      .send({ message: error.message, code: error.code });
  });

  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@fastify/awilix' }),
  );

  const options: TenancyPluginOptions = { resolverOrder };
  if (resolveMembership) {
    (options as { resolveMembership?: ResolveMembershipFn }).resolveMembership =
      resolveMembership;
  }
  if (getUserId) {
    (options as { getUserId?: TenancyPluginOptions['getUserId'] }).getUserId =
      getUserId;
  }
  await fastify.register(createTenancyPlugin, options);

  await registerRoutes?.(fastify);
  await fastify.ready();
  return { fastify, tenantStorage, tenantContext };
};

describe('createTenancyPlugin (integration)', () => {
  let harness: Awaited<ReturnType<typeof buildFastify>> | undefined;

  beforeEach(() => {
    harness = undefined;
  });
  afterEach(async () => {
    await harness?.fastify.close();
  });

  it('first non-null resolver wins (header beats subdomain)', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader(), fromSubdomain()],
      registerRoutes: (f) =>
        f.get('/whoami', (request) => ({
          tenantId: request.tenant?.tenantId ?? null,
        })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-tenant-id': 'header-tenant', host: 'sub.example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: 'header-tenant' });
  });

  it('falls through to the next resolver when the first yields null', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader(), fromSubdomain()],
      registerRoutes: (f) =>
        f.get('/whoami', (request) => ({
          tenantId: request.tenant?.tenantId ?? null,
        })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { host: 'acme.example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: 'acme' });
  });

  it('returns 400 with TENANT_NOT_RESOLVED when no resolver matches', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) => f.get('/whoami', () => ({ ok: true })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'TENANT_NOT_RESOLVED',
    });
  });

  it('skips resolution for routes marked with withTenantBypass()', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) =>
        f.route({
          method: 'POST',
          url: '/auth/register',
          ...withTenantBypass(),
          handler: (request) => ({ tenant: request.tenant ?? null }),
        }),
    });

    const response = await harness.fastify.inject({
      method: 'POST',
      url: '/auth/register',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenant: null });
  });

  it('withTenantBypass(existingConfig) merges existing config keys', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) =>
        f.route({
          method: 'POST',
          url: '/auth/register',
          ...withTenantBypass({ rateLimit: { max: 5 } }),
          handler: (request) => ({
            tenant: request.tenant ?? null,
            // rateLimit was preserved -- routeOptions exposes it on
            // FastifyContextConfig.
            rateLimit: (
              request.routeOptions.config as { rateLimit?: { max: number } }
            ).rateLimit,
          }),
        }),
    });

    const response = await harness.fastify.inject({
      method: 'POST',
      url: '/auth/register',
    });

    expect(response.json()).toEqual({
      tenant: null,
      rateLimit: { max: 5 },
    });
  });

  it('throws TenantNotResolved when a bypass handler reads currentTenant', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) =>
        f.route({
          method: 'GET',
          url: '/leaky',
          ...withTenantBypass(),
          handler: () => f.currentTenant(),
        }),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/leaky',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'TENANT_NOT_RESOLVED' });
  });

  it('decorates request.tenant with the resolved id', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) =>
        f.get('/whoami', (request) => ({ tenant: request.tenant })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.json()).toEqual({ tenant: { tenantId: 'acme' } });
  });

  it('opens the AsyncLocalStorage frame so handlers can read currentTenant()', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) => f.get('/handler', () => f.currentTenant()),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/handler',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: 'acme' });
  });

  it('exposes the ALS frame to preHandler hooks registered after tenancy', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      registerRoutes: (f) => {
        f.addHook('preHandler', async (request) => {
          (request as { observedInPreHandler?: string }).observedInPreHandler =
            f.currentTenant().tenantId;
        });
        f.get('/observed', (request) => ({
          observed: (request as { observedInPreHandler?: string })
            .observedInPreHandler,
        }));
      },
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/observed',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.json()).toEqual({ observed: 'acme' });
  });

  it('exposes fastify.withTenant for non-request callers', async () => {
    harness = await buildFastify({ resolverOrder: [fromHeader()] });

    const observed = await harness.fastify.withTenant('job-tenant', async () =>
      harness!.fastify.currentTenant(),
    );

    expect(observed).toEqual({ tenantId: 'job-tenant' });
  });

  it('propagates resolver errors as 500', async () => {
    harness = await buildFastify({
      resolverOrder: [explodingResolver],
      registerRoutes: (f) => f.get('/whoami', () => ({ ok: true })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: 'resolver kaput' });
  });

  it('returns 403 MEMBERSHIP_REQUIRED when resolveMembership returns null', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      // Force a userId so the membership check fires (default
      // `getUserId` reads request.auth?.sub).
      getUserId: () => 'u-1',
      resolveMembership: async () => null,
      registerRoutes: (f) => f.get('/whoami', () => ({ ok: true })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
  });

  it('populates request.membership when resolveMembership returns one', async () => {
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      getUserId: () => 'u-1',
      resolveMembership: async ({ tenantId }) => ({ tenantId, role: 'owner' }),
      registerRoutes: (f) =>
        f.get('/whoami', (request) => ({
          membership: request.membership ?? null,
        })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.json()).toEqual({
      membership: { tenantId: 'acme', role: 'owner' },
    });
  });

  it('skips resolveMembership when no userId is available (pre-auth)', async () => {
    let called = false;
    harness = await buildFastify({
      resolverOrder: [fromHeader()],
      getUserId: () => null,
      resolveMembership: async () => {
        called = true;
        return null;
      },
      registerRoutes: (f) =>
        f.get('/whoami', (request) => ({ tenant: request.tenant ?? null })),
    });

    const response = await harness.fastify.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-tenant-id': 'acme' },
    });

    expect(response.statusCode).toBe(200);
    expect(called).toBe(false);
    expect(response.json()).toEqual({ tenant: { tenantId: 'acme' } });
  });
});
