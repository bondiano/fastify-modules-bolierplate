import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

import {
  RegisterBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  LogoutBodySchema,
  AuthResultSchema,
  RefreshResultSchema,
} from '@kit/auth/schemas';
import {
  createSuccessResponseSchema,
  apiErrorEnvelopeSchema,
  ok,
} from '@kit/schemas';

const authRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  const { authService } = fastify.diContainer.cradle;

  // POST /auth/register -- runs before any tenant exists for this user.
  fastify.route({
    method: 'POST',
    url: '/register',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: RegisterBodySchema,
      response: {
        201: createSuccessResponseSchema(AuthResultSchema),
        409: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await authService.register(request.body);
      return reply.status(201).send(ok(result));
    },
  });

  // POST /auth/login -- bypass; the JWT may carry a tenant claim later
  // but at login time the request has no resolved tenant yet.
  fastify.route({
    method: 'POST',
    url: '/login',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: LoginBodySchema,
      response: {
        200: createSuccessResponseSchema(AuthResultSchema),
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const result = await authService.login(request.body);
      return ok(result);
    },
  });

  // POST /auth/refresh
  fastify.route({
    method: 'POST',
    url: '/refresh',
    config: {
      tenant: 'bypass',
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['auth'],
      body: RefreshBodySchema,
      response: {
        200: createSuccessResponseSchema(RefreshResultSchema),
        401: apiErrorEnvelopeSchema,
      },
    },
    handler: async (request) => {
      const tokens = await authService.refresh(request.body.refreshToken);
      return ok(tokens);
    },
  });

  // POST /auth/logout -- blacklists the refresh token
  fastify.route({
    method: 'POST',
    url: '/logout',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      body: LogoutBodySchema,
      response: {
        204: { type: 'null' as const },
      },
    },
    handler: async (request, reply) => {
      await authService.logout(request.body.refreshToken);
      return reply.status(204).send(null);
    },
  });

  // POST /auth/clear-sessions -- invalidates all tokens issued before now
  fastify.route({
    method: 'POST',
    url: '/clear-sessions',
    config: { tenant: 'bypass' },
    schema: {
      tags: ['auth'],
      response: {
        204: { type: 'null' as const },
        401: apiErrorEnvelopeSchema,
      },
    },
    onRequest: [fastify.verifyUser],
    handler: async (request, reply) => {
      await authService.clearSessions(request.auth!.sub);
      return reply.status(204).send(null);
    },
  });
};

export default authRoute;
export const autoPrefix = '/auth';
