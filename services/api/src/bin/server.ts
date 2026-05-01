#!/usr/bin/env -S node

import { Redis } from 'ioredis';

import { config } from '#config.ts';
import { createRegistrationStore } from '#modules/auth/registration-store.ts';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { authzProvider } from '@kit/authz/provider';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { setupGracefulShutdown } from '@kit/core/server';
import { closeDataSource, createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createTenantContext, createTenantStorage } from '@kit/tenancy';

const main = async () => {
  const logger = createLogger({
    name: config.APP_NAME,
    level: config.LOG_LEVEL,
    pretty: config.isDev,
  });

  logger.info('Starting API server...');

  const dataSource = createDataSource({
    logger,
    connectionString: config.DATABASE_URL,
    maxConnections: config.DATABASE_MAX_CONNECTIONS,
    logQueries: config.DATABASE_LOG_QUERIES,
  });

  const transactionStorage = await createTransactionStorage();
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const container = await createContainer({
    logger,
    config,
    extraValues: {
      dataSource,
      transactionStorage,
      tenantStorage,
      tenantContext,
      redis,
    },
    modulesGlobs: [
      `${import.meta.dirname}/../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
    ],
    providers: [
      dbProvider(),
      authProvider({
        resolveUserStore: ({
          transaction,
          usersRepository,
          tenantsService,
        }: Dependencies) =>
          createRegistrationStore({
            transaction,
            usersRepository,
            tenantsService,
          }),
        resolveTokenBlacklistStore: ({ redis }: Dependencies) =>
          createTokenBlacklistService({ redis }),
      }),
      authzProvider({
        definers: [defineUserAbilities, definePostAbilities],
      }),
    ],
  });

  const server = await createServer({ config, container, logger, redis });

  setupGracefulShutdown(async () => {
    await server.close();
    await closeDataSource(dataSource);
    await redis.quit();
  }, logger);

  await server.listen({ host: config.HOST, port: config.PORT });

  logger.info(`API server listening on http://${config.HOST}:${config.PORT}`);
};

try {
  await main();
} catch (error) {
  console.error('Failed to start API server:', error);
  process.exit(1);
}
