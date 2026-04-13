import { z } from 'zod';

import { loadEnvironmentFiles } from './load-env.js';
import { parseEnv, port } from './parse-env.js';

export { z } from 'zod';
export { port } from './parse-env.js';

export const Environment = {
  Development: 'development',
  Test: 'test',
  Staging: 'staging',
  Production: 'production',
} as const;

export type EnvironmentValue = (typeof Environment)[keyof typeof Environment];

export const baseConfigSchema = {
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  ENVIRONMENT: z
    .enum([
      Environment.Development,
      Environment.Test,
      Environment.Staging,
      Environment.Production,
    ])
    .default(Environment.Development),
  HOST: z.string().default('0.0.0.0'),
  PORT: port().default(3000),
  APP_NAME: z.string().default('fastify-saas-kit'),
  APP_VERSION: z.string().default('0.0.0'),
} as const;

export type BaseConfigSchema = typeof baseConfigSchema;

type ZodSchemaRecord = Record<string, z.ZodTypeAny>;

export type InferConfig<TSchema extends ZodSchemaRecord> = {
  [K in keyof TSchema]: z.infer<TSchema[K]>;
} & {
  readonly isDev: boolean;
  readonly isTest: boolean;
  readonly isStaging: boolean;
  readonly isProd: boolean;
};

export type BaseConfig = InferConfig<BaseConfigSchema>;

export interface CreateConfigOptions {
  /** Directory containing .env files. When provided, loads .env files before parsing. */
  readonly envPath?: string;
  /** Override process.env for testing. Skips .env file loading when provided. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Create a typed, validated config object from env vars + Zod schema.
 *
 * Merges `baseConfigSchema` with the provided extra schema, optionally loads
 * .env files (cascading by ENVIRONMENT), and validates all variables.
 *
 * @example
 * ```ts
 * const config = createConfig(
 *   { DATABASE_URL: z.string(), REDIS_URL: z.string() },
 *   { envPath: findWorkspaceRoot(import.meta.dirname) },
 * );
 * ```
 */
export const createConfig = <TExtra extends ZodSchemaRecord>(
  extraSchema: TExtra = {} as TExtra,
  options: CreateConfigOptions = {},
): InferConfig<BaseConfigSchema & TExtra> => {
  const { envPath, env } = options;

  if (envPath && !env) {
    loadEnvironmentFiles(envPath);
  }

  const source = env ?? process.env;
  const schema = { ...baseConfigSchema, ...extraSchema };

  const parsed = parseEnv(source, schema) as InferConfig<
    BaseConfigSchema & TExtra
  >;

  return {
    ...parsed,
    isDev: parsed.ENVIRONMENT === Environment.Development,
    isTest: parsed.ENVIRONMENT === Environment.Test,
    isStaging: parsed.ENVIRONMENT === Environment.Staging,
    isProd: parsed.ENVIRONMENT === Environment.Production,
  } as InferConfig<BaseConfigSchema & TExtra>;
};
