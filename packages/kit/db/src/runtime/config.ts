import { z } from 'zod';

/**
 * Config schema fragment for database connection.
 * Merge into your app-level config schema via `createConfig({ ...dbConfigSchema })`.
 */
export const dbConfigSchema = {
  DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  DATABASE_LOG_QUERIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
};

export type DbConfig = {
  DATABASE_URL: string;
  DATABASE_MAX_CONNECTIONS: number;
  DATABASE_LOG_QUERIES: boolean;
};
