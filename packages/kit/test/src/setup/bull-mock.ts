import type { FastifyRedis } from '@fastify/redis';
import { vi } from 'vitest';

interface QueueOptions {
  readonly connection: FastifyRedis;
}

class Queue {
  private readonly connection: FastifyRedis;

  constructor(_name: string, options: QueueOptions) {
    this.connection = options.connection;
  }

  async add(name: string, data: object) {
    this.connection.lpush(name, JSON.stringify(data));
  }
}

// bullmq doesn't work with ioredis-mock, so we mock the Queue class
vi.mock('bullmq', async (importOriginal) => {
  const module_: object = await importOriginal();
  return { ...module_, Queue };
});
