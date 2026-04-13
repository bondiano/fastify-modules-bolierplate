import type { Worker } from 'bullmq';

/**
 * Global job data registry. Each job file augments this interface so
 * queue.add() and worker handlers are fully typed.
 *
 * @example
 * ```ts
 * declare module '@kit/jobs' {
 *   interface Jobs {
 *     'send-welcome-email': { userId: string };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Jobs {}

/**
 * Global queue registry. Auto-populated by the jobs plugin based on
 * directory structure (queue name = parent directory of job file).
 *
 * @example
 * ```ts
 * declare module '@kit/jobs' {
 *   interface Queues {
 *     notifications: Queue<Jobs['send-welcome-email']>;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Queues {}

export type Workers = {
  [K in keyof Jobs]: Worker<Jobs[K]>;
};

export type QueueMap = {
  [K in keyof Queues]: Queues[K];
};

declare module 'fastify' {
  interface FastifyInstance {
    queues: QueueMap;
    workers: Workers;
  }
}

declare global {
  interface Dependencies {
    queues: QueueMap;
    workers: Workers;
  }
}
