#!/usr/bin/env -S node

import repl from 'node:repl';

import { Redis } from 'ioredis';

import { config } from '#config.ts';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { authzProvider } from '@kit/authz/provider';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';

const logger = createLogger({
  name: config.APP_NAME,
  level: config.LOG_LEVEL,
  pretty: true,
});

const dataSource = createDataSource({
  logger,
  connectionString: config.DATABASE_URL,
  maxConnections: config.DATABASE_MAX_CONNECTIONS,
  logQueries: config.DATABASE_LOG_QUERIES,
});

const transactionStorage = await createTransactionStorage();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const container = await createContainer({
  logger,
  config,
  extraValues: { dataSource, transactionStorage, redis },
  modulesGlobs: [
    `${import.meta.dirname}/../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
  ],
  providers: [
    dbProvider(),
    authProvider({
      resolveUserStore: ({ usersRepository }: Dependencies) =>
        usersRepository.asUserStore(),
      resolveTokenBlacklistStore: ({ redis }: Dependencies) =>
        createTokenBlacklistService({ redis }),
    }),
    authzProvider({
      definers: [defineUserAbilities, definePostAbilities],
    }),
  ],
});

const server = await createServer({ config, container, logger, redis });

const r = repl.start({
  useColors: true,
  prompt: `@${config.APP_NAME}> `,
});

r.setupHistory('.node_repl_history', (error) => {
  if (error) {
    console.error(error);
  }
});

r.context.container = container;
r.context.server = server;
r.context.config = config;
r.context.logger = logger;
r.context.redis = redis;
r.context.dataSource = dataSource;

r.on('exit', async () => {
  await server.close();
  await dataSource.destroy();
  await redis.quit();
  process.exit(0);
});
