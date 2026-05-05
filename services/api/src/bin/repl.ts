#!/usr/bin/env -S node

import repl from 'node:repl';

import { Redis } from 'ioredis';

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
import { createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import {
  createTenantContext,
  createTenantStorage,
  type TenantContextValue,
} from '@kit/tenancy';

const logger = createLogger({
  name: config.APP_NAME,
  level: config.LOG_LEVEL,
  pretty: true,
});

const dataSource = createDataSource<DB>({
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
      resolvePasswordResetTokenStore: ({
        passwordResetTokenRepository,
      }: Dependencies) => passwordResetTokenRepository,
      resolveEmailVerificationTokenStore: ({
        emailVerificationTokenRepository,
      }: Dependencies) => emailVerificationTokenRepository,
      resolveOtpCodeStore: ({ otpCodeRepository }: Dependencies) =>
        otpCodeRepository,
    }),
    authzProvider({
      definers: [defineUserAbilities, definePostAbilities],
    }),
  ],
});

const server = await createServer({ config, container, logger, redis });

const defaultTenant = await dataSource
  .selectFrom('tenants')
  .select(['id', 'slug', 'name'])
  .where('deletedAt', 'is', null)
  .orderBy('createdAt', 'asc')
  .executeTakeFirst();

if (defaultTenant) {
  tenantStorage.enterWith({ tenantId: defaultTenant.id });
  logger.info(
    {
      tenantId: defaultTenant.id,
      slug: defaultTenant.slug,
      name: defaultTenant.name,
    },
    'REPL tenant context auto-selected. Use useTenant(id) / withTenant(id, fn) to switch.',
  );
} else {
  logger.warn(
    'No tenants found. Tenant-scoped repos will throw TenantNotResolved until you call useTenant(id).',
  );
}

const useTenant = (tenantId: string): TenantContextValue => {
  const value: TenantContextValue = { tenantId };
  tenantStorage.enterWith(value);
  return value;
};

const withTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  tenantContext.withTenant(tenantId, fn);

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
r.context.tenantContext = tenantContext;
r.context.tenantStorage = tenantStorage;
r.context.useTenant = useTenant;
r.context.withTenant = withTenant;
r.context.currentTenant = () => tenantContext.tryCurrentTenant();

r.on('exit', async () => {
  await server.close();
  await dataSource.destroy();
  await redis.quit();
  process.exit(0);
});

// /* sql */ `BEGIN TRANSACTION
// SELECT 1;
// END TRANSACTION;`;
