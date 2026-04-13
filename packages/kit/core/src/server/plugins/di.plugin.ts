import { fastifyAwilixPlugin } from '@fastify/awilix';
import type { AwilixContainer } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DiPluginOptions {
  container: AwilixContainer;
}

const diPlugin = async (fastify: FastifyInstance, options: DiPluginOptions) => {
  await fastify.register(fastifyAwilixPlugin, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    container: options.container as any,
    asyncInit: true,
    asyncDispose: true,
    strictBooleanEnforced: true,
    disposeOnClose: true,
    disposeOnResponse: false,
  });
};

export default fp(diPlugin, { name: 'di' });
