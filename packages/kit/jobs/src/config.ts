import { z } from 'zod';

/**
 * Config schema fragment for @kit/jobs. Merge into your app config:
 *
 * ```ts
 * import { jobsConfigSchema } from '@kit/jobs/config';
 * const config = createConfig({ ...jobsConfigSchema, ...otherSchemas });
 * ```
 */
export const jobsConfigSchema = {
  REDIS_URL: z.string().url().describe('Redis connection URL for BullMQ'),
};
