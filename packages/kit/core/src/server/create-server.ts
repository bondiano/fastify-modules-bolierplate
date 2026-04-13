import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AutoLoad from '@fastify/autoload';
import Cors, { type FastifyCorsOptions } from '@fastify/cors';
import Helmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import RateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { AwilixContainer } from 'awilix';
import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyServerOptions,
} from 'fastify';

import type { BaseConfig } from '@kit/config';

import type { Logger } from '../logger/index.js';

import type { IdempotencyPluginOptions } from './idempotency.js';
import configPlugin from './plugins/config.plugin.js';
import diPlugin from './plugins/di.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import healthPlugin from './plugins/health.plugin.js';
import idempotencyPlugin from './plugins/idempotency.plugin.js';
import requestContextPlugin from './plugins/request-context.plugin.js';
import swaggerPlugin from './plugins/swagger.plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A kit plugin descriptor for inline registration in `createServer`.
 * Accepts either a bare Fastify plugin (when no options are needed) or
 * an object with `plugin` and `options`.
 *
 * Plugin name and dependencies are read from the plugin itself (set via
 * `fastify-plugin`), so they don't need to be repeated here.
 */

export type KitPlugin =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | FastifyPluginAsync<any>
  | {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      readonly plugin: FastifyPluginAsync<any>;
      readonly options?: Record<string, unknown>;
    };

export interface SecurityOptions {
  helmet?: FastifyHelmetOptions | false;
  cors?: FastifyCorsOptions | false;
  rateLimit?: RateLimitPluginOptions | false;
}

export interface SwaggerOptions {
  enabled?: boolean;
  title?: string;
  version?: string;
  description?: string;
  routePrefix?: string;
}

export interface CreateServerOptions {
  config: BaseConfig;
  container: AwilixContainer;
  logger: Logger;
  fastify?: FastifyServerOptions;
  security?: SecurityOptions;
  swagger?: SwaggerOptions;
  /**
   * Absolute path to a directory whose files export Fastify plugins to be
   * auto-loaded after core plugins. Typically `services/api/src/server/plugins`.
   */
  pluginsDir?: string;
  /**
   * Absolute path to a directory of modules whose `*.route.ts` files should
   * be registered as Fastify route plugins.
   */
  modulesDir?: string;
  /**
   * API version string (e.g. `'v1'`, `'v2'`). Used to compute the default
   * `routesPrefix` as `api/{apiVersion}`. Ignored when `routesPrefix` is set
   * explicitly. Defaults to `'v1'`.
   */
  apiVersion?: string;
  /**
   * URL prefix for auto-loaded route plugins. Defaults to `api/v1` (or
   * `api/{apiVersion}` when `apiVersion` is provided).
   */
  routesPrefix?: string;
  /**
   * Idempotency key plugin options. Pass an object with a `store` to enable
   * per-route idempotency via `withIdempotency()`. Pass `false` or omit to
   * disable.
   */
  idempotency?: IdempotencyPluginOptions | false;
  /**
   * Kit plugins to register after core plugins and before route auto-loading.
   * Replaces the need for thin wrapper files in a `pluginsDir`.
   *
   * @example
   * ```ts
   * plugins: [
   *   createErrorHandlerPlugin,
   *   createAuthPlugin,
   *   createAuthzPlugin,
   *   { plugin: createJobsPlugin, options: { redis, jobsPathPattern: '...' } },
   * ]
   * ```
   */
  plugins?: readonly KitPlugin[];
}

export type KitFastifyInstance = FastifyInstance & {
  withTypeProvider: FastifyInstance['withTypeProvider'];
};

const defaultCors: FastifyCorsOptions = {
  origin: false,
  credentials: true,
};

const defaultRateLimit: RateLimitPluginOptions = {
  global: true,
  max: 100,
  timeWindow: '1 minute',
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true,
  },
};

export const createServer = async (
  options: CreateServerOptions,
): Promise<FastifyInstance> => {
  const {
    config,
    container,
    logger,
    fastify: fastifyOptions = {},
    security = {},
    swagger = {},
    pluginsDir,
    modulesDir,
    apiVersion,
    routesPrefix: explicitPrefix,
  } = options;

  const routesPrefix =
    explicitPrefix ?? (apiVersion ? `api/${apiVersion}` : 'api/v1');

  const fastify = Fastify({
    loggerInstance: logger,
    genReqId: (req) => (req.headers['request-id'] as string) ?? randomUUID(),
    disableRequestLogging: false,
    ...fastifyOptions,
  }).withTypeProvider<TypeBoxTypeProvider>();

  // --- Security (on by default; pass `false` to disable) ---
  if (security.helmet !== false) {
    await fastify.register(Helmet, { global: true, ...security.helmet });
  }
  if (security.cors !== false) {
    await fastify.register(Cors, { ...defaultCors, ...security.cors });
  }
  if (security.rateLimit !== false) {
    await fastify.register(RateLimit, {
      ...defaultRateLimit,
      ...security.rateLimit,
    });
  }

  // --- Core plugins ---
  await fastify.register(configPlugin, { config });
  await fastify.register(errorHandlerPlugin);
  await fastify.register(requestContextPlugin);
  await fastify.register(diPlugin, { container });

  if (swagger.enabled !== false) {
    await fastify.register(swaggerPlugin, {
      ...(swagger.title ? { title: swagger.title } : {}),
      ...(swagger.version ? { version: swagger.version } : {}),
      ...(swagger.description ? { description: swagger.description } : {}),
      routePrefix: swagger.routePrefix ?? '/docs',
    });
  }

  await fastify.register(healthPlugin, {
    statusPrefix: `/${routesPrefix}/status`,
  });

  // --- Idempotency (opt-in) ---
  if (options.idempotency) {
    await fastify.register(idempotencyPlugin, options.idempotency);
  }

  // --- Kit plugins (inline registration) ---
  if (options.plugins) {
    for (const entry of options.plugins) {
      await (typeof entry === 'function'
        ? fastify.register(entry)
        : fastify.register(entry.plugin, entry.options));
    }
  }

  // --- User plugins (auto-loaded from consumer's plugins dir) ---
  if (pluginsDir) {
    await fastify.register(AutoLoad, {
      dir: pluginsDir,
      dirNameRoutePrefix: false,
      forceESM: true,
    });
  }

  // --- User routes (auto-loaded from modules dir by `*.route.{ts,js}` suffix) ---
  if (modulesDir) {
    await fastify.register(
      async (scoped) => {
        await scoped.register(AutoLoad, {
          dir: modulesDir,
          dirNameRoutePrefix: false,
          forceESM: true,
          matchFilter: (filePath: string) =>
            filePath.endsWith('.route.ts') || filePath.endsWith('.route.js'),
        });
      },
      { prefix: routesPrefix },
    );
  }

  // Silence "unused" lint on __dirname when nothing references it.
  void __dirname;

  return fastify;
};
