import {
  fastifyRequestContext,
  requestContext,
} from '@fastify/request-context';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module '@fastify/request-context' {
  interface RequestContextData {
    requestId: string;
  }
}

const requestContextPlugin = async (fastify: FastifyInstance) => {
  await fastify.register(fastifyRequestContext);

  fastify.addHook('onRequest', async (req) => {
    requestContext.set('requestId', req.id as string);
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
