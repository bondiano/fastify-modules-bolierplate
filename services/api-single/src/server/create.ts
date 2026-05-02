import type { AwilixContainer } from 'awilix';

import type { AppConfig } from '#config.ts';
import type { Logger } from '@kit/core/logger';
import {
  createServer as createKitServer,
  type SecurityOptions,
} from '@kit/core/server';
import { createErrorHandlerPlugin } from '@kit/errors/plugin';

export interface CreateServerOptions {
  config: AppConfig;
  container: AwilixContainer;
  logger: Logger;
  security?: SecurityOptions;
}

export const createServer = async ({
  config,
  container,
  logger,
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
      description: 'Fastify single-tenant API example',
    },
    plugins: [createErrorHandlerPlugin],
    modulesDir: new URL('../modules', import.meta.url).pathname,
  });
};
