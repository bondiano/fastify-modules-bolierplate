#!/usr/bin/env -S node

import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import { createServer } from '#server/create.ts';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { setupGracefulShutdown } from '@kit/core/server';
import { closeDataSource, createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';

const main = async () => {
  const logger = createLogger({
    name: config.APP_NAME,
    level: config.LOG_LEVEL,
    pretty: config.isDev,
  });

  logger.info('Starting api-single server (no tenancy)...');

  const dataSource = createDataSource<DB>({
    logger,
    connectionString: config.DATABASE_URL,
    maxConnections: config.DATABASE_MAX_CONNECTIONS,
    logQueries: config.DATABASE_LOG_QUERIES,
  });

  const transactionStorage = await createTransactionStorage<DB>();

  const container = await createContainer({
    logger,
    config,
    extraValues: {
      dataSource,
      transactionStorage,
    },
    modulesGlobs: [
      `${import.meta.dirname}/../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
    ],
    providers: [dbProvider()],
  });

  const server = await createServer({ config, container, logger });

  setupGracefulShutdown(async () => {
    await server.close();
    await closeDataSource(dataSource);
  }, logger);

  await server.listen({ host: config.HOST, port: config.PORT });

  logger.info(`api-single listening on http://${config.HOST}:${config.PORT}`);
};

try {
  await main();
} catch (error) {
  console.error('Failed to start api-single server:', error);
  process.exit(1);
}
