#!/usr/bin/env -S node

import { Redis } from 'ioredis';

import { config } from '#config.ts';
import { createKitOAuthRegistry } from '#modules/auth/oauth-registry.ts';
import { createRegistrationStore } from '#modules/auth/registration-store.ts';
import { createTokenBlacklistService } from '#modules/auth/token-blacklist.service.ts';
import { createBillingCustomersRepository } from '#modules/billing/billing-customers.repository.ts';
import { createBillingWebhookEventsRepository } from '#modules/billing/billing-webhook-events.repository.ts';
import { createInvoicesRepository } from '#modules/billing/invoices.repository.ts';
import { createPaymentMethodsRepository } from '#modules/billing/payment-methods.repository.ts';
import {
  createFeaturesRepository,
  createPlanFeaturesRepository,
  createPlansRepository,
  createPricesRepository,
} from '#modules/billing/plans.repository.ts';
import { createSubscriptionsRepository } from '#modules/billing/subscriptions.repository.ts';
// Side-effect import: registers billing mail templates with the kit's
// `MailTemplates` registry before any `mailerService.send(...)` call.
import '#modules/mailer/billing-templates.seed.ts';
import { createMailDeliveriesRepository } from '#modules/mailer/mail-deliveries.repository.ts';
import { createMailEventsRepository } from '#modules/mailer/mail-events.repository.ts';
import { createMailSuppressionsRepository } from '#modules/mailer/mail-suppressions.repository.ts';
import { definePostAbilities } from '#modules/posts/posts.abilities.ts';
import { defineUserAbilities } from '#modules/users/users.abilities.ts';
import { createServer } from '#server/create.ts';
import { authProvider } from '@kit/auth/provider';
import { authzProvider } from '@kit/authz/provider';
import {
  billingProvider,
  createBillingProvider,
  type EntitlementsCache,
} from '@kit/billing';
import { createContainer } from '@kit/core/di';
import { createLogger } from '@kit/core/logger';
import { setupGracefulShutdown } from '@kit/core/server';
import { closeDataSource, createDataSource, dbProvider } from '@kit/db/runtime';
import { createTransactionStorage } from '@kit/db/transaction';
import { createTransport, mailerProvider } from '@kit/mailer';
import { createTenantContext, createTenantStorage } from '@kit/tenancy';

/**
 * Phase-2c default for the per-tenant `from` resolver: until DKIM
 * verification (Phase 3) the kit always falls back to the platform
 * `MAIL_FROM`. Hoisted to module scope so eslint's
 * `unicorn/consistent-function-scoping` rule doesn't flag the closure
 * inside `mailerProvider({...})`. Replace this with a real
 * `tenantsRepository.findById(tenantId)` lookup once DKIM verification
 * lands.
 */
const noTenantFromOverride = async (): Promise<{
  from: string;
  fromName?: string;
} | null> => null;

/**
 * Redis-backed entitlements cache. Mirrors the suppression cache shape
 * from `@kit/mailer`: get/set/delete keyed by string, TTL via `EX`.
 */
const createRedisEntitlementsCache = (redis: Redis): EntitlementsCache => ({
  async get(key) {
    return await redis.get(key);
  },
  async set(key, value, ttlSeconds) {
    await redis.set(key, value, 'EX', ttlSeconds);
  },
  async delete(key) {
    await redis.del(key);
  },
});

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

  // Build the active mail transport once at startup so a misconfigured
  // provider (missing API key, region, etc.) crashes here -- rather
  // than on the first send hours into a deploy.
  const mailTransport = createTransport(config);

  // Build the active billing provider once at startup. Same fail-fast
  // story as the mail transport.
  const billingProviderInstance = createBillingProvider(config);
  const entitlementsCache = createRedisEntitlementsCache(redis);
  // OAuth provider registry -- only providers with `*_CLIENT_ID` set
  // get instantiated. Apple + Microsoft are scaffolded for P3 and
  // throw on construction in v1.
  const oauthRegistry = createKitOAuthRegistry();

  const container = await createContainer({
    logger,
    config,
    extraValues: {
      dataSource,
      transactionStorage,
      tenantStorage,
      tenantContext,
      redis,
      oauthRegistry,
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
        // Mailer hooks: enqueue a `mail_deliveries` row + BullMQ job.
        // The actual transport call happens asynchronously in the
        // `mail.send` worker, so the originating request returns
        // quickly and a transport outage doesn't block auth flows.
        onPasswordResetRequested: async (event) => {
          const { mailerService } = container.cradle as Dependencies;
          await mailerService.send(
            'password-reset',
            {
              resetUrl: `${config.APP_URL}/auth/password-reset/confirm?token=${encodeURIComponent(event.token)}`,
              expiresAt: event.expiresAt.toUTCString(),
              productName: config.APP_NAME,
            },
            {
              idempotencyKey: `password-reset:${event.userId}:${event.expiresAt.toISOString()}`,
              to: event.email,
              tenantId: null,
              userId: event.userId,
            },
          );
        },
        onEmailVerificationRequested: async (event) => {
          const { mailerService } = container.cradle as Dependencies;
          await mailerService.send(
            'verify-email',
            {
              email: event.email,
              verifyUrl: `${config.APP_URL}/auth/email-verification/confirm?token=${encodeURIComponent(event.token)}`,
              expiresAt: event.expiresAt.toUTCString(),
              productName: config.APP_NAME,
            },
            {
              idempotencyKey: `verify-email:${event.userId}:${event.expiresAt.toISOString()}`,
              to: event.email,
              tenantId: null,
              userId: event.userId,
            },
          );
        },
        onOtpRequested: async (event) => {
          const { mailerService } = container.cradle as Dependencies;
          await mailerService.send(
            'otp-code',
            {
              code: event.code,
              expiresAt: event.expiresAt.toUTCString(),
              productName: config.APP_NAME,
            },
            {
              // OTPs are short-lived and one-shot; key includes the
              // expiresAt so a re-request invalidates the old delivery
              // (the user can still see the latest mail).
              idempotencyKey: `otp:${event.userId}:${event.purpose}:${event.expiresAt.toISOString()}`,
              to: event.email,
              tenantId: null,
              userId: event.userId,
            },
          );
        },
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
        // BullMQ enqueue. `queues.mail` is auto-discovered by `@kit/jobs`
        // from `modules/mailer/jobs/mail/*.job.ts`. `jobId` = idempotency
        // key dedupes job-level enqueues across retries.
        resolveDispatchJob:
          ({ queues }: Dependencies) =>
          async (deliveryId, idempotencyKey) => {
            await queues.mail.add(
              'mail.send',
              { deliveryId },
              { jobId: idempotencyKey },
            );
          },
        resolveDefaultFrom: () => ({
          from: config.MAIL_FROM,
          ...(config.MAIL_FROM_NAME ? { fromName: config.MAIL_FROM_NAME } : {}),
        }),
        // Per-tenant `from` resolution: until DKIM verification ships
        // (Phase 3) we always fall back to the platform `from`. The
        // column ships now so consumers can populate it; the kit's
        // `mailerService` will start honouring the override once
        // `mail_from_verified_at` is set + the DKIM-verification job
        // lands.
        resolveTenantFromOverride: () => noTenantFromOverride,
      }),
      billingProvider({
        resolveBillingProvider: () => billingProviderInstance,
        resolveBillingCustomersRepository: ({
          transaction,
          tenantContext,
        }: Dependencies) =>
          createBillingCustomersRepository({ transaction, tenantContext }),
        resolveSubscriptionsRepository: ({
          transaction,
          tenantContext,
        }: Dependencies) =>
          createSubscriptionsRepository({ transaction, tenantContext }),
        resolveInvoicesRepository: ({
          transaction,
          tenantContext,
        }: Dependencies) =>
          createInvoicesRepository({ transaction, tenantContext }),
        resolvePaymentMethodsRepository: ({
          transaction,
          tenantContext,
        }: Dependencies) =>
          createPaymentMethodsRepository({ transaction, tenantContext }),
        resolvePlansRepository: ({ transaction }: Dependencies) =>
          createPlansRepository({ transaction }),
        resolvePricesRepository: ({ transaction }: Dependencies) =>
          createPricesRepository({ transaction }),
        resolveFeaturesRepository: ({ transaction }: Dependencies) =>
          createFeaturesRepository({ transaction }),
        resolvePlanFeaturesRepository: ({ transaction }: Dependencies) =>
          createPlanFeaturesRepository({ transaction }),
        resolveWebhookEventsRepository: ({ transaction }: Dependencies) =>
          createBillingWebhookEventsRepository({ transaction }),
        resolveEntitlementsCache: () => entitlementsCache,
        resolveRedirectAllowlistOrigin: () => new URL(config.APP_URL).origin,
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
