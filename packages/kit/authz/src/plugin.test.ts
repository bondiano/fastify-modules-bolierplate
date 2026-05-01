import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAbilityFactory,
  type AuthzMembership,
  type DefineAbilities,
} from './ability.js';
import { createAuthzPlugin, type AuthzPluginOptions } from './plugin.js';

const defineInviteAbilities: DefineAbilities = (_user, builder, membership) => {
  if (membership?.role === 'owner' || membership?.role === 'admin') {
    builder.can('create', 'Invitation');
  }
};

interface BuildOptions {
  pluginOptions?: AuthzPluginOptions;
  registerRoutes: (fastify: FastifyInstance) => void;
}

const buildFastify = async ({
  pluginOptions,
  registerRoutes,
}: BuildOptions) => {
  const fastify = Fastify({ logger: false });
  const factory = createAbilityFactory({ definers: [defineInviteAbilities] });

  fastify.decorate('diContainer', { cradle: { abilityFactory: factory } });
  fastify.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as { statusCode?: number; message?: string };
    reply.status(error.statusCode ?? 500).send({ message: error.message });
  });

  await fastify.register(
    fp(async (): Promise<void> => {}, { name: '@fastify/awilix' }),
  );

  await fastify.register(createAuthzPlugin, pluginOptions ?? {});
  registerRoutes(fastify);
  await fastify.ready();
  return fastify;
};

describe('createAuthzPlugin (membership integration)', () => {
  let fastify: FastifyInstance | undefined;

  afterEach(async () => {
    await fastify?.close();
    fastify = undefined;
  });

  it('reads membership off the request when getMembership is not overridden', async () => {
    fastify = await buildFastify({
      registerRoutes: (f) => {
        f.addHook('onRequest', async (request) => {
          (request as unknown as { auth: { sub: string; role: string } }).auth =
            {
              sub: 'u-1',
              role: 'user',
            };
          request.membership = { tenantId: 'acme', role: 'owner' };
        });
        f.route({
          method: 'POST',
          url: '/invitations',
          preHandler: [f.authorize('create', 'Invitation')],
          handler: async () => ({ ok: true }),
        });
      },
    });

    const res = await fastify.inject({ method: 'POST', url: '/invitations' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('denies the action when the membership role does not grant it', async () => {
    fastify = await buildFastify({
      registerRoutes: (f) => {
        f.addHook('onRequest', async (request) => {
          (request as unknown as { auth: { sub: string; role: string } }).auth =
            {
              sub: 'u-1',
              role: 'user',
            };
          request.membership = { tenantId: 'acme', role: 'member' };
        });
        f.route({
          method: 'POST',
          url: '/invitations',
          preHandler: [f.authorize('create', 'Invitation')],
          handler: async () => ({ ok: true }),
        });
      },
    });

    const res = await fastify.inject({ method: 'POST', url: '/invitations' });
    expect(res.statusCode).toBe(403);
  });

  it('uses a custom getMembership override when provided', async () => {
    let capturedMembership: AuthzMembership | undefined;
    fastify = await buildFastify({
      pluginOptions: {
        getMembership: () => {
          capturedMembership = { tenantId: 'globex', role: 'admin' };
          return capturedMembership;
        },
      },
      registerRoutes: (f) => {
        f.addHook('onRequest', async (request) => {
          (request as unknown as { auth: { sub: string; role: string } }).auth =
            {
              sub: 'u-1',
              role: 'user',
            };
        });
        f.route({
          method: 'POST',
          url: '/invitations',
          preHandler: [f.authorize('create', 'Invitation')],
          handler: async () => ({ ok: true }),
        });
      },
    });

    const res = await fastify.inject({ method: 'POST', url: '/invitations' });
    expect(res.statusCode).toBe(200);
    expect(capturedMembership).toEqual({ tenantId: 'globex', role: 'admin' });
  });

  it('passes undefined membership when neither request.membership nor override is set', async () => {
    fastify = await buildFastify({
      registerRoutes: (f) => {
        f.addHook('onRequest', async (request) => {
          (request as unknown as { auth: { sub: string; role: string } }).auth =
            {
              sub: 'u-1',
              role: 'user',
            };
        });
        f.route({
          method: 'POST',
          url: '/invitations',
          preHandler: [f.authorize('create', 'Invitation')],
          handler: async () => ({ ok: true }),
        });
      },
    });

    const res = await fastify.inject({ method: 'POST', url: '/invitations' });
    expect(res.statusCode).toBe(403);
  });
});
