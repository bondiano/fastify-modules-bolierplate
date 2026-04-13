import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type {
  IdempotencyPluginOptions,
  IdempotencyStore,
} from '../idempotency.js';

declare module 'fastify' {
  interface FastifyInstance {
    idempotencyStore: IdempotencyStore;
    idempotencyTtl: number;
    idempotencyHeaderName: string;
  }
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyActive?: boolean;
  }
}

const DEFAULT_TTL = 86_400_000; // 24 hours
const DEFAULT_HEADER = 'idempotency-key';

const idempotencyPlugin = async (
  fastify: FastifyInstance,
  options: IdempotencyPluginOptions,
) => {
  fastify.decorate('idempotencyStore', options.store);
  fastify.decorate('idempotencyTtl', options.ttl ?? DEFAULT_TTL);
  fastify.decorate(
    'idempotencyHeaderName',
    options.headerName ?? DEFAULT_HEADER,
  );

  fastify.decorateRequest('idempotencyKey');
  fastify.decorateRequest('idempotencyActive');
};

export default fp(idempotencyPlugin, {
  name: 'idempotency',
});
