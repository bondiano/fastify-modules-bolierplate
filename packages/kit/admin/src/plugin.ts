/**
 * Fastify plugin that boots the @kit/admin panel:
 *
 *   1. Queries `information_schema` to build a `SchemaRegistry`.
 *   2. Walks the Awilix cradle for repositories that quack like
 *      `AdminDiscoverable`.
 *   3. Loads optional `*.admin.ts` override modules and merges them.
 *   4. Registers a scoped sub-instance under `prefix` that serves the
 *      public routes (`/login`, `/_assets/*`), and inside that a nested
 *      protected scope that enforces admin auth for every other route.
 *
 * The plugin is a single `fastify-plugin` so it inherits the parent's
 * decorators (`verifyAdmin`, `authorize`, `diContainer`) without extra
 * wiring from the consumer.
 */
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { FormatRegistry } from '@sinclair/typebox';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';
import { html } from 'htm/preact';
import type { Kysely } from 'kysely';

import { InternalServerErrorException } from '@kit/errors';

import { renderPage } from './render.js';
import {
  assetsRoute,
  createRoute,
  dashboardRoute,
  deleteRoute,
  detailRoute,
  listRoute,
  loginRoute,
  relationsRoute,
  tenantsSwitcherRoute,
  updateRoute,
} from './routes/index.js';
import { loadOverrides } from './runtime/auto-loader.js';
import { buildAdminSpecs } from './runtime/build-specs.js';
import type { AdminContext, AdminRuntimeOptions } from './runtime/context.js';
import { createCsrfService } from './runtime/csrf.js';
import { createAdminRegistry } from './runtime/registry.js';
import { createSchemaRegistry } from './schema/index.js';

/**
 * Configuration for the admin plugin. The plugin auto-discovers every
 * repository in the Awilix cradle, builds a schema registry from
 * `information_schema`, merges any `*.admin.ts` overrides found via
 * `modulesGlob`, and registers admin routes under `prefix`.
 */
export interface AdminPluginOptions {
  /** URL prefix for every admin route. Defaults to `/admin`. */
  readonly prefix?: string;
  /** Browser title rendered in the layout. */
  readonly title?: string;
  /**
   * Absolute glob pattern used to find `*.admin.ts` override files,
   * typically `new URL('../modules/**\/*.admin.ts', import.meta.url).pathname`
   * from the consuming service.
   */
  readonly modulesGlob?: string;
  /** Narrow discovery to this exact list of table names. */
  readonly includeTables?: readonly string[];
  /** Skip these tables even if a repository exposes them. */
  readonly excludeTables?: readonly string[];
  /** Override the vendored asset URL prefix. Defaults to `${prefix}/_assets`. */
  readonly assetPrefix?: string;
  /** Signing secret for CSRF tokens. Falls back to JWT_SECRET via DI. */
  readonly csrfSecret?: string;
}

const DEFAULT_PREFIX = '/admin';
const DEFAULT_TITLE = 'Admin';
const ACCESS_COOKIE = '__Host-admin_session';

interface FastifyWithDi extends FastifyInstance {
  diContainer: { cradle: Record<string, unknown> };
}

const getCradle = (fastify: FastifyInstance): Record<string, unknown> => {
  const f = fastify as FastifyWithDi;
  if (!f.diContainer || !f.diContainer.cradle) {
    throw new InternalServerErrorException(
      '@kit/admin: diContainer is not available; did @fastify/awilix run?',
    );
  }
  return f.diContainer.cradle;
};

const resolveCsrfSecret = (
  opts: AdminPluginOptions,
  cradle: Record<string, unknown>,
): string => {
  if (opts.csrfSecret && opts.csrfSecret.length > 0) return opts.csrfSecret;

  // `JWT_SECRET` is already a high-entropy secret the service is configured
  // with. Reusing it for CSRF signing is fine: the HMAC output is never
  // sent anywhere except as a form field the signer itself will verify.
  const config = cradle['config'];
  if (config && typeof config === 'object') {
    const jwt = (config as Record<string, unknown>)['JWT_SECRET'];
    if (typeof jwt === 'string' && jwt.length > 0) return jwt;
  }
  throw new InternalServerErrorException(
    '@kit/admin: CSRF secret unavailable (no csrfSecret option and no config.JWT_SECRET in cradle)',
  );
};

const attachBearerFromCookie = async (
  request: FastifyRequest,
): Promise<void> => {
  if (request.headers.authorization) return;
  const cookies = (
    request as FastifyRequest & { cookies?: Record<string, string> }
  ).cookies;
  const token = cookies?.[ACCESS_COOKIE];
  if (token) request.headers.authorization = `Bearer ${token}`;
};

interface MembershipsRepoShape {
  findAllForUser(
    userId: string,
  ): Promise<readonly { tenantId: string; role: string }[]>;
}

interface TenantsRepoRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

interface TenantsRepoShape {
  findById(id: string): Promise<TenantsRepoRow | undefined>;
}

const isMembershipsRepoShape = (v: unknown): v is MembershipsRepoShape =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { findAllForUser?: unknown }).findAllForUser === 'function';

const isTenantsRepoShape = (v: unknown): v is TenantsRepoShape =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { findById?: unknown }).findById === 'function';

/**
 * Awilix's cradle proxy throws `AwilixResolutionError` on a `get` for an
 * unregistered key. Use `Object.keys` (it returns only registered names
 * for both Awilix and plain-object test cradles) plus a try/catch to
 * keep the optional integration silent when tenancy isn't installed.
 */
const safeCradleGet = <T>(
  cradle: Record<string, unknown>,
  key: string,
  guard: (value: unknown) => value is T,
): T | null => {
  if (!Object.keys(cradle).includes(key)) return null;
  try {
    const value = cradle[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Populate `request.adminTenantInfo` from cradle-resolved tenancy
 * repositories when present. Best-effort: silent no-op when the
 * consumer doesn't register tenancy (single-tenant deployments) or
 * when a repo call throws -- the layout simply hides the block.
 */
const attachAdminTenantInfo = (
  cradle: Record<string, unknown>,
): ((request: FastifyRequest) => Promise<void>) => {
  const memberships = safeCradleGet(
    cradle,
    'membershipsRepository',
    isMembershipsRepoShape,
  );
  const tenants = safeCradleGet(
    cradle,
    'tenantsRepository',
    isTenantsRepoShape,
  );
  if (!memberships || !tenants) {
    return async () => {};
  }
  return async (request) => {
    const auth = request.auth;
    if (!auth) return;
    let canSwitch = false;
    try {
      const rows = await memberships.findAllForUser(auth.sub);
      canSwitch = rows.length > 1;
    } catch {
      // best-effort
    }
    const currentId = request.tenant?.tenantId;
    let label = currentId ?? null;
    if (currentId) {
      try {
        const tenant = await tenants.findById(currentId);
        label = tenant?.name ?? currentId;
      } catch {
        // fall back to id
      }
    }
    request.adminTenantInfo = {
      current: currentId ? { id: currentId, label: label ?? currentId } : null,
      canSwitch,
    };
  };
};

const renderErrorPage = (
  opts: AdminRuntimeOptions,
  status: number,
  message: string,
): string =>
  renderPage(
    {
      title: opts.title,
      assetPrefix: opts.assetPrefix,
      csrfToken: 'error',
      nav: [],
    },
    html`<section class="admin-error">
      <h1>${status}</h1>
      <p>${message}</p>
    </section>`,
  );

const UUID_RE =
  /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

const ensureFormats = (): void => {
  if (!FormatRegistry.Has('uuid'))
    FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));
  if (!FormatRegistry.Has('date-time'))
    FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
  if (!FormatRegistry.Has('date'))
    FormatRegistry.Set('date', (v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
};

const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (
  fastify,
  opts,
) => {
  ensureFormats();

  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  const assetPrefix = opts.assetPrefix ?? `${prefix}/_assets`;
  const title = opts.title ?? DEFAULT_TITLE;
  const runtimeOptions: AdminRuntimeOptions = { prefix, assetPrefix, title };

  const cradle = getCradle(fastify);

  const dataSource = cradle['dataSource'];
  if (!dataSource) {
    throw new InternalServerErrorException(
      '@kit/admin: `dataSource` missing from DI cradle',
    );
  }

  const schemaRegistry = await createSchemaRegistry({
    dataSource: dataSource as Kysely<unknown>,
    ...(opts.includeTables ? { includeTables: opts.includeTables } : {}),
    ...(opts.excludeTables ? { excludeTables: opts.excludeTables } : {}),
  });

  const overrides = await loadOverrides({
    modulesGlob: opts.modulesGlob,
    logger: fastify.log,
  });

  const { specs, repos } = await buildAdminSpecs({
    cradle,
    schemaRegistry,
    overrides,
    logger: fastify.log,
    ...(opts.includeTables ? { includeTables: opts.includeTables } : {}),
    ...(opts.excludeTables ? { excludeTables: opts.excludeTables } : {}),
  });

  const registry = createAdminRegistry(specs);
  const csrf = createCsrfService({ secret: resolveCsrfSecret(opts, cradle) });

  const context: AdminContext = {
    registry,
    repos,
    csrf,
    options: runtimeOptions,
  };

  fastify.log.info(
    { prefix, resources: specs.map((s) => s.name) },
    '@kit/admin: registering admin panel',
  );

  await fastify.register(
    async (scope) => {
      // Register formbody first so the login POST sees parsed form data.
      // `cookie` ships its own content-type parser so order doesn't matter.
      await scope.register(fastifyFormbody);
      // Consumers that wire `@fastify/cookie` at the root level (e.g. so
      // the global tenancy resolver chain can read the admin-switcher
      // cookie) will already have `reply.setCookie` here -- skip the
      // inner registration to avoid Fastify's "decorator already
      // exists" error.
      if (!scope.hasReplyDecorator('setCookie')) {
        await scope.register(fastifyCookie);
      }

      scope.decorate('admin', context);

      // Public routes first -- no auth hook on this scope.
      await scope.register(assetsRoute);
      await scope.register(loginRoute);

      // Protected scope: everything below requires an admin session.
      await scope.register(async (protectedScope) => {
        protectedScope.addHook('onRequest', attachBearerFromCookie);
        protectedScope.addHook('onRequest', async (request, reply) => {
          // If we still have no bearer after the cookie hook, redirect HTML
          // navigations to the login page; htmx requests get a 401 so the
          // client shows a toast instead of replacing the fragment.
          if (request.headers.authorization) return;
          if (request.headers['hx-request'] !== undefined) {
            reply.status(401).send();
            return reply;
          }
          reply.redirect(`${prefix}/login`);
          return reply;
        });
        // `verifyAdmin` is provided by @kit/auth. The augmentation in
        // `runtime/context.ts` types it as optional because the admin
        // package does not take a hard import dependency on the plugin;
        // at runtime it must be there (declared in plugin dependencies).
        const verifyAdmin = protectedScope.verifyAdmin;
        if (!verifyAdmin) {
          throw new InternalServerErrorException(
            '@kit/admin: fastify.verifyAdmin missing (is @kit/auth registered before @kit/admin?)',
          );
        }
        protectedScope.addHook('onRequest', verifyAdmin);
        protectedScope.addHook('onRequest', attachAdminTenantInfo(cradle));

        // HTML error page for full-page nav requests. Set BEFORE the
        // route registrations: Fastify v5 only inherits the handler into
        // child scopes that exist at the time of the call. Tenant-required
        // errors redirect to the switcher; everything else renders the
        // standard error page (htmx requests fall through to JSON).
        protectedScope.setErrorHandler((error, request, reply) => {
          const errRecord = error as {
            statusCode?: unknown;
            message?: unknown;
            code?: unknown;
          };
          if (errRecord.code === 'TENANT_REQUIRED_FOR_ADMIN') {
            const url = `${prefix}/_tenants`;
            if (request.headers['hx-request'] !== undefined) {
              reply.header('hx-redirect', url);
              reply.status(204);
              return '';
            }
            reply.redirect(url);
            return reply;
          }
          if (request.headers['hx-request'] !== undefined) {
            throw error;
          }
          const status =
            typeof errRecord.statusCode === 'number'
              ? errRecord.statusCode
              : 500;
          const message =
            typeof errRecord.message === 'string'
              ? errRecord.message
              : 'Unexpected error';
          reply.status(status).type('text/html; charset=utf-8');
          return renderErrorPage(runtimeOptions, status, message);
        });

        await protectedScope.register(tenantsSwitcherRoute);
        await protectedScope.register(dashboardRoute);
        await protectedScope.register(listRoute);
        await protectedScope.register(createRoute);
        await protectedScope.register(detailRoute);
        await protectedScope.register(updateRoute);
        await protectedScope.register(deleteRoute);
        await protectedScope.register(relationsRoute);
      });
    },
    { prefix },
  );
};

export const createAdminPlugin = fp(adminPlugin, {
  name: '@kit/admin',
  dependencies: ['@fastify/awilix', '@kit/auth', '@kit/authz'],
});

export default createAdminPlugin;
