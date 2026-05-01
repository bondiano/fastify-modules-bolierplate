import fastifyCookie from '@fastify/cookie';
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
import {
  createTenancyPlugin,
  fromCookie,
  fromHeader,
  fromJwtClaim,
  fromUserDefault,
  type ResolveMembershipFn,
} from '@kit/tenancy';

import { createAdminActionsPlugin } from './admin-actions.plugin.ts';
import { createBestEffortAuthPlugin } from './best-effort-auth.plugin.ts';

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
      createBestEffortAuthPlugin,
      // `@fastify/cookie` is registered at the root so the global
      // tenancy resolver chain below sees `request.cookies` for the
      // admin tenant-switcher cookie. `@kit/admin` checks for the
      // `setCookie` decorator and skips re-registering inside its own
      // scope.
      async (fastify) => {
        await fastify.register(fastifyCookie);
      },
      {
        plugin: createTenancyPlugin,
        options: {
          // Resolver chain runs in declaration order; first non-null wins.
          // Public / pre-tenant routes opt out via `withTenantBypass()`.
          // `__Host-admin_tenant` is the cookie name set by the admin's
          // tenant switcher (RFC 6265bis `__Host-` prefix is part of the
          // name, not stripped by parsers).
          resolverOrder: [
            fromHeader('x-tenant-id'),
            fromCookie('__Host-admin_tenant'),
            fromJwtClaim('tenant_id'),
            fromUserDefault({
              resolveDefaultTenant: (userId) => {
                const { usersRepository } = container.cradle as Dependencies;
                return usersRepository.findDefaultTenantId(userId);
              },
            }),
          ],
          // Closes the `X-Tenant-ID` / cookie / JWT-claim spoofing hole:
          // the resolved tenant id is verified against the user's
          // memberships before any scoped code runs. Returning `null`
          // makes the plugin throw 403 `MembershipRequired`.
          resolveMembership: (async ({ tenantId, userId }) => {
            const { membershipsRepository } = container.cradle as Dependencies;
            const membership = await membershipsRepository.findByUserAndTenant(
              userId,
              tenantId,
            );
            return membership
              ? { tenantId: membership.tenantId, role: membership.role }
              : null;
          }) satisfies ResolveMembershipFn,
        },
      },
      {
        plugin: createAdminPlugin,
        options: {
          prefix: '/admin',
          title: `${config.APP_NAME} Admin`,
          modulesGlob: new URL('../modules/**/*.admin.ts', import.meta.url)
            .pathname,
        },
      },
      // Custom admin-prefix routes that back `defineAdminResource(...).detailActions`.
      // Registered after `@kit/admin` so it can rely on `verifyAdmin`.
      createAdminActionsPlugin,
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
