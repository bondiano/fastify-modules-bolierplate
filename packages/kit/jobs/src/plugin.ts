import path from 'node:path';

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { Queue, Worker } from 'bullmq';
import fg from 'fast-glob';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import type { JobConfig } from './create-job.js';

export interface JobsPluginOptions {
  /**
   * Glob pattern to discover job files.
   * Queue name is derived from the parent directory of each job file.
   *
   * @example `./modules/jobs/*.job.ts`
   */
  readonly jobsPathPattern: string;

  /**
   * Redis connection instance. BullMQ requires `maxRetriesPerRequest: null`.
   * The plugin duplicates the connection for queue and subscriber clients.
   */
  readonly redis: Redis;

  /**
   * Enable BullBoard UI at the given base path.
   * Set to `false` to disable, or a string to customize the path.
   *
   * @default false
   */
  readonly bullBoard?: string | false;

  /**
   * Default worker concurrency (number of parallel jobs per worker).
   * Can be overridden per-job via `workerConfig.concurrency`.
   *
   * @default 1
   */
  readonly defaultConcurrency?: number;
}

const resolveQueueName = (filePath: string): string => {
  const parts = filePath.split('/');
  const queueName = parts.at(-2);
  if (!queueName) {
    throw new Error(`Cannot derive queue name from job file path: ${filePath}`);
  }
  return queueName;
};

const jobsPlugin = async (
  fastify: FastifyInstance,
  options: JobsPluginOptions,
): Promise<void> => {
  const { jobsPathPattern, redis, defaultConcurrency = 1 } = options;

  const queueClient = redis.duplicate();
  const subscriberClient = redis.duplicate();

  const queues: Record<string, Queue> = {};
  const workers: Record<string, Worker<unknown>> = {};
  const files = fg.sync(jobsPathPattern);

  for (const filePath of files) {
    const queueName = resolveQueueName(filePath);

    const imported: { default: JobConfig } = await import(
      path.resolve(filePath)
    );
    const { job, handler } = imported.default;

    if (!queues[queueName]) {
      queues[queueName] = new Queue(queueName, {
        connection: queueClient,
        ...job.queueConfig,
      });
    }

    if (job.repeat) {
      await queues[queueName].upsertJobScheduler(
        `repeat:${job.name}`,
        job.repeat,
        {
          name: job.name,
        },
      );
    }

    const worker = new Worker(
      queueName,
      (workerJob) => {
        if (workerJob.name !== job.name) return Promise.resolve();
        return handler(fastify, workerJob);
      },
      {
        connection: subscriberClient,
        name: job.name,
        concurrency: defaultConcurrency,
        ...job.workerConfig,
      },
    );

    worker.on('failed', (failedJob, error) => {
      fastify.log.error(
        { err: error, jobId: failedJob?.id, jobName: job.name, queueName },
        `Job "${job.name}" failed`,
      );
    });

    worker.on('completed', (completedJob) => {
      fastify.log.debug(
        { jobId: completedJob.id, jobName: job.name, queueName },
        `Job "${job.name}" completed`,
      );
    });

    workers[job.name] = worker;

    fastify.log.info(
      { jobName: job.name, queueName, repeat: !!job.repeat },
      `Registered job "${job.name}" on queue "${queueName}"`,
    );
  }

  // BullBoard
  const boardPath = options.bullBoard ?? false;
  if (boardPath !== false) {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(boardPath);

    createBullBoard({
      queues: Object.values(queues).map((q) => new BullMQAdapter(q)),
      serverAdapter,
    });

    await fastify.register(serverAdapter.registerPlugin(), {
      prefix: boardPath,
    });

    fastify.log.info(`BullBoard UI available at ${boardPath}`);
  }

  fastify.decorate('queues', queues as never);
  fastify.decorate('workers', workers as never);

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down job workers and queues...');

    await Promise.all(Object.values(workers).map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));

    await queueClient.quit();
    await subscriberClient.quit();

    fastify.log.info('Job workers and queues shut down');
  });
};

export const createJobsPlugin = fp(jobsPlugin, {
  name: '@kit/jobs',
});

export default createJobsPlugin;
