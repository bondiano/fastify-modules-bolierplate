import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from 'fastify-plugin';
// @ts-expect-error -- ioredis-mock types are outdated
import Redis from 'ioredis-mock';
import { vi } from 'vitest';

const fastifyRedisMock: FastifyPluginAsyncTypebox = async (fastify) => {
  const client = new Redis();
  fastify.decorate('redis', client);
};

vi.mock('@fastify/redis', () => ({
  default: fp(fastifyRedisMock, {
    fastify: '5.x',
    name: '@fastify/redis',
  }),
}));
