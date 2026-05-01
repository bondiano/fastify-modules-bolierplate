import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Tenancy resolution runs in `onRequest`, so `request.auth` must be
 * populated before the resolver chain fires -- otherwise `fromJwtClaim`
 * and `fromUserDefault` always return null. This plugin runs a
 * best-effort `verifyJwt` whenever a Bearer token is present and
 * silently swallows verification errors. Routes that strictly require
 * auth still gate via `fastify.verifyUser`, which 401s when the token
 * is missing or invalid.
 */
const bestEffortAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    if (request.auth) return;
    if (!request.headers.authorization) return;
    try {
      await fastify.verifyJwt(request);
    } catch {
      // Routes that require auth will fail later via `verifyUser`.
    }
  });
};

export const createBestEffortAuthPlugin = fp(bestEffortAuthPlugin, {
  name: 'best-effort-auth',
  dependencies: ['@kit/auth'],
});

export default createBestEffortAuthPlugin;
