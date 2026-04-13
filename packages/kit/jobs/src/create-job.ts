import type { Job, QueueOptions, RepeatOptions, WorkerOptions } from 'bullmq';
import type { FastifyInstance } from 'fastify';

export type JobHandler<TData = unknown> = (
  fastify: FastifyInstance,
  job: Job<TData>,
) => Promise<void>;

export interface JobOptions {
  readonly name: string;
  readonly queueConfig?: Partial<QueueOptions>;
  readonly workerConfig?: Partial<WorkerOptions>;
  readonly repeat?: RepeatOptions;
}

export interface JobConfig<TData = unknown> {
  readonly job: JobOptions;
  readonly handler: JobHandler<TData>;
}

/**
 * Factory for defining a typed background job. Returns a frozen config
 * object with `{ job, handler }` that the jobs plugin auto-discovers.
 *
 * Each job file should `export default` the result of `createJob()`.
 *
 * @example
 * ```ts
 * // modules/users/jobs/notifications/send-welcome-email.job.ts
 * import { createJob } from '@kit/jobs';
 *
 * declare module '@kit/jobs' {
 *   interface Jobs {
 *     'send-welcome-email': { userId: string };
 *   }
 * }
 *
 * export default createJob('send-welcome-email', async (fastify, job) => {
 *   const { usersService } = fastify.diContainer.cradle;
 *   await usersService.sendWelcomeEmail(job.data.userId);
 * });
 * ```
 *
 * @example With cron schedule
 * ```ts
 * export default createJob('cleanup-expired-tokens', async (fastify) => {
 *   const { tokensService } = fastify.diContainer.cradle;
 *   await tokensService.cleanupExpired();
 * }, {
 *   repeat: { pattern: '0 * * * *' }, // every hour
 * });
 * ```
 */
export const createJob = <TData = unknown>(
  name: string,
  handler: JobHandler<TData>,
  options?: Omit<JobOptions, 'name'>,
): JobConfig<TData> =>
  Object.freeze({
    job: Object.freeze({ name, ...options }),
    handler,
  });
