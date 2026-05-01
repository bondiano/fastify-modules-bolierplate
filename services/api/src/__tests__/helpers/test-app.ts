import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- ioredis-mock types are outdated
import Redis from 'ioredis-mock';

import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import { createRegistrationStore } from '#modules/auth/registration-store.ts';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { authzProvider } from '@kit/authz/provider';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createTenantContext, createTenantStorage } from '@kit/tenancy';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';
import type { TestApp } from '@kit/test/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '../../../migrations');

export const createTestApp = async (): Promise<TestApp<DB>> => {
  const logger = createLogger({ name: 'test', level: 'silent' });
  const dataSource = await createTestDataSource<DB>();
  const transactionStorage = await createTransactionStorage<DB>();
  const tenantStorage = createTenantStorage();
  const tenantContext = createTenantContext({ tenantStorage });
  const redis = new Redis();

  // Migrations must run BEFORE the server boots because @kit/admin
  // queries information_schema during plugin registration.
  await migrateToLatest(dataSource, migrationsPath);

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
      `${__dirname}/../../modules/**/*.{repository,service,mapper,client}.{js,ts}`,
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

  const server = await createServer({
    config,
    container,
    logger,
    redis,
    security: { rateLimit: false },
  });

  return { server, dataSource };
};
