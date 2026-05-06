import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- ioredis-mock types are outdated
import Redis from 'ioredis-mock';

import { config } from '#config.ts';
import type { DB } from '#db/schema.ts';
import { createRegistrationStore } from '#modules/auth/registration-store.ts';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';
import { createMailDeliveriesRepository } from '#modules/mailer/mail-deliveries.repository.ts';
import { createMailEventsRepository } from '#modules/mailer/mail-events.repository.ts';
import { createMailSuppressionsRepository } from '#modules/mailer/mail-suppressions.repository.ts';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { authzProvider } from '@kit/authz/provider';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createDevMemoryTransport, mailerProvider } from '@kit/mailer';
import { createTenantContext, createTenantStorage } from '@kit/tenancy';
import { createTestDataSource, migrateToLatest } from '@kit/test/database';
import type { TestApp } from '@kit/test/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsPath = path.join(__dirname, '../../../migrations');

const noTenantFromOverride = async (): Promise<{
  from: string;
  fromName?: string;
} | null> => null;

/** Stubbed BullMQ enqueue. Tests don't run workers, so the outbox
 * stays at `status='queued'`; tests can inspect rows directly via
 * `dataSource.selectFrom('mail_deliveries')`. Hoisted to module scope
 * so eslint's `unicorn/consistent-function-scoping` rule doesn't flag
 * it inline inside `mailerProvider({...})`. */
const noopDispatchJob = async (): Promise<void> => {};

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

  // Tests use the in-process `dev-memory` transport. Each test that
  // wants to assert on captured mail can read `transport.outbox` (the
  // transport instance lives on the cradle as `mailTransport`).
  const mailTransport = createDevMemoryTransport();

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
      mailerProvider({
        resolveTransport: () => mailTransport,
        resolveDeliveriesRepository: ({
          transaction,
          tenantContext,
        }: Dependencies) =>
          createMailDeliveriesRepository({ transaction, tenantContext }),
        resolveEventsRepository: ({ transaction }: Dependencies) =>
          createMailEventsRepository({ transaction }),
        resolveSuppressionsRepository: ({
          transaction,
          tenantContext,
          redis,
        }: Dependencies) =>
          createMailSuppressionsRepository({
            transaction,
            tenantContext,
            redis,
          }),
        // Tests don't run BullMQ workers; the dispatch callback
        // no-ops. Assertions on delivery state read
        // `mail_deliveries.status` directly (stays `'queued'`).
        resolveDispatchJob: () => noopDispatchJob,
        resolveDefaultFrom: () => ({
          from: config.MAIL_FROM,
          ...(config.MAIL_FROM_NAME ? { fromName: config.MAIL_FROM_NAME } : {}),
        }),
        resolveTenantFromOverride: () => noTenantFromOverride,
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
