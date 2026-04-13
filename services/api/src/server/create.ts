import type { AwilixContainer } from 'awilix';
import type { Redis } from 'ioredis';

import type { AppConfig } from '#config.ts';
import { createAdminPlugin } from '@kit/admin/plugin';
import { createAuthPlugin } from '@kit/auth/plugin';
import { createAuthzPlugin } from '@kit/authz/plugin';
import type { Logger } from '@kit/core/logger';
import {
  createServer as createKitServer,
  type SecurityOptions,
} from '@kit/core/server';
import { createErrorHandlerPlugin } from '@kit/errors/plugin';
import { createJobsPlugin } from '@kit/jobs/plugin';

export interface CreateServerOptions {
  config: AppConfig;
  container: AwilixContainer;
  logger: Logger;
  redis: Redis;
  security?: SecurityOptions;
}

export const createServer = async ({
  config,
  container,
  logger,
  redis,
  security,
}: CreateServerOptions) => {
  const corsOrigin =
    config.CORS_ORIGINS === '*' ? true : config.CORS_ORIGINS.split(',');

  return createKitServer({
    config,
    container,
    logger,
    security: security ?? {
      cors: { origin: corsOrigin, credentials: true },
    },
    swagger: {
      enabled: config.isDev || config.isStaging,
      title: config.APP_NAME,
      version: config.APP_VERSION,
      description: 'Fastify SaaS Kit API',
    },
    plugins: [
      createErrorHandlerPlugin,
      createAuthPlugin,
      createAuthzPlugin,
      {
        plugin: createAdminPlugin,
        options: {
          prefix: '/admin',
          title: `${config.APP_NAME} Admin`,
          modulesGlob: new URL('../modules/**/*.admin.ts', import.meta.url)
            .pathname,
        },
      },
      {
        plugin: createJobsPlugin,
        options: {
          jobsPathPattern: new URL(
            '../modules/**/jobs/**/*.job.{js,ts}',
            import.meta.url,
          ).pathname,
          redis,
          bullBoard: config.isDev ? '/admin/queues' : false,
        },
      },
    ],
    modulesDir: new URL('../modules', import.meta.url).pathname,
  });
};
