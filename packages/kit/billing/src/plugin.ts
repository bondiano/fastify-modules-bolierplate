/**
 * Optional Fastify plugin that decorates `fastify.requireFeature(key)`.
 *
 * Usage (in services/api/src/server/create.ts):
 *
 * ```ts
 * import { createBillingPlugin } from '@kit/billing/plugin';
 *
 * await createKitServer({
 *   ..., plugins: [..., createBillingPlugin],
 * });
 * ```
 *
 * Then on a route:
 *
 * ```ts
 * fastify.route({
 *   url: '/api/exports/csv',
 *   onRequest: [fastify.verifyUser, fastify.requireFeature('export-csv')],
 *   handler: ...,
 * });
 * ```
 *
 * The decorator throws `EntitlementCheckFailed` (HTTP 403) when the
 * resolved feature map for the current tenant does not enable the
 * requested feature key. Internally it consults the DI cradle's
 * `entitlementsService` -- which in turn reads the Redis-backed
 * cache + falls back to the DB -- so the per-route check stays cheap.
 */
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import type { EntitlementsService } from './entitlements-service.js';
import { EntitlementCheckFailed } from './errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireFeature(
      featureKey: string,
    ): (request: FastifyRequest) => Promise<void>;
  }
}

interface BillingCradle {
  entitlementsService: EntitlementsService;
}

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: BillingCradle };
}

interface RequestWithTenant extends FastifyRequest {
  tenant?: { tenantId: string };
}

const billingPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const fastifyWithDi = fastify as FastifyWithDi;
  fastify.decorate('requireFeature', (featureKey: string) => {
    return async (request: FastifyRequest) => {
      const cradle = fastifyWithDi.diContainer.cradle;
      const requestWithTenant = request as RequestWithTenant;
      const tenantId = requestWithTenant.tenant?.tenantId;
      if (!tenantId) {
        // Caller forgot to register the tenancy plugin; fail closed.
        throw new EntitlementCheckFailed(featureKey, 'unknown');
      }
      const enabled = await cradle.entitlementsService.isFeatureEnabled(
        featureKey,
        tenantId,
      );
      if (!enabled) {
        throw new EntitlementCheckFailed(featureKey, tenantId);
      }
    };
  });
};

export const createBillingPlugin = fp(billingPlugin, {
  name: '@kit/billing',
  dependencies: ['@fastify/awilix'],
});

export default createBillingPlugin;
